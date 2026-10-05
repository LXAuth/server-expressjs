import { prisma } from '../../lib/prisma.js';
import { generateToken } from '../../lib/crypto.js';
import { getPaymentProvider } from '../../lib/payment/provider.js';
import { AccountType, MembershipTier, isValidEnumValue, MEMBERSHIP_TIERS } from '../../lib/enums.js';
import { badRequest, conflict, forbidden, notFound, paymentFailed } from '../../lib/errors.js';
import { requireWalletAdmin } from '../wallets/wallet.service.js';
import { logger } from '../../lib/logger.js';
import type { UpgradeMembershipInput } from './membership.schemas.js';

/**
 * Membership tiers.
 *
 * `account_memberships` is one row per account holding the *current* tier, with
 * `time_start` and `time_end` bounding the period. A cancelled membership sets
 * `time_end` and the row is left in place rather than deleted, so "when did this
 * account's enterprise plan lapse" stays answerable.
 *
 * Note that upgrading writes the tier **in place** rather than appending a row.
 * That is the specified table's shape — one membership per account — so history
 * of tier changes is not retained. Worth knowing before anyone relies on it for
 * billing reconciliation.
 */

export interface MembershipView {
  membershipId: number;
  accountId: number;
  tier: string;
  timeStart: Date;
  timeEnd: Date | null;
  /** True when `timeEnd` has passed. A stale row reads as expired, not free. */
  isExpired: boolean;
}

/**
 * Authorization for membership operations.
 *
 * Reuses `requireWalletAdmin` rather than writing a second rule. Both questions
 * — "may this caller manage this account's wallets" and "may this caller change
 * this account's plan" — are the same question: may they administer the account.
 * A separate check would be a second place for the rule to drift.
 */
async function requireMembershipAdmin(actorAccountId: number, accountId: number): Promise<void> {
  await requireWalletAdmin(actorAccountId, accountId);
}

/** `GET /accounts/{account_id}/membership` */
export async function getMembership(
  actorAccountId: number,
  accountId: number,
): Promise<MembershipView> {
  await requireMembershipAdmin(actorAccountId, accountId);

  const membership = await prisma.account_memberships.findFirst({
    where: { accountId },
    orderBy: { timeStart: 'desc' },
    select: {
      id: true,
      accountId: true,
      tier: true,
      timeStart: true,
      timeEnd: true,
    },
  });

  // An account always gets a free membership at registration. A missing row
  // means the account was created outside that path, so report free rather than
  // 404 — the caller's question is "what plan is this on", and free is the
  // truthful answer when nothing was ever bought.
  if (!membership) {
    return {
      membershipId: 0,
      accountId,
      tier: MembershipTier.free,
      timeStart: new Date(0),
      timeEnd: null,
      isExpired: false,
    };
  }

  if (!isValidEnumValue(MEMBERSHIP_TIERS, membership.tier)) {
    // Should be impossible: Postgres has a CHECK constraint from task 3. Failing
    // loudly beats reporting an unrecognised tier as though it were valid.
    throw badRequest(`Membership tier is not recognised: ${membership.tier}.`);
  }

  return {
    membershipId: membership.id,
    accountId: membership.accountId ?? accountId,
    tier: membership.tier,
    timeStart: membership.timeStart,
    timeEnd: membership.timeEnd,
    isExpired: membership.timeEnd !== null && membership.timeEnd.getTime() <= Date.now(),
  };
}

/**
 * `POST /accounts/{account_id}/membership/upgrade`
 *
 * The payment provider is called **before** the tier is written, never after.
 * Writing first and charging second means a declined card leaves an account on
 * the tier it just paid for, and the refund path is somebody's problem. Here a
 * declined charge leaves the account exactly where it was, which is the state
 * that is always safe to be in.
 */
export async function upgradeMembership(
  actorAccountId: number,
  accountId: number,
  input: UpgradeMembershipInput,
): Promise<MembershipView> {
  await requireMembershipAdmin(actorAccountId, accountId);

  const account = await prisma.accounts.findUnique({
    where: { id: accountId },
    select: { id: true, type: true, status: true },
  });

  if (!account || account.status === 'deleted') {
    throw notFound('Account', accountId);
  }

  // An organization changing its own plan is the ordinary case. An agent account
  // has no billing relationship in this build, so there is nothing to charge.
  if (account.type === AccountType.agent) {
    throw forbidden('Agent accounts cannot hold a paid membership.');
  }

  const current = await prisma.account_memberships.findFirst({
    where: { accountId },
    orderBy: { timeStart: 'desc' },
    select: { id: true, tier: true, timeEnd: true },
  });

  if (current && !isValidEnumValue(MEMBERSHIP_TIERS, current.tier)) {
    throw badRequest(`Membership tier is not recognised: ${current.tier}.`);
  }

  const currentTier = (current?.tier ?? MembershipTier.free) as MembershipTier;

  if (currentTier === input.targetTier) {
    // Not a conflict worth charging for. Idempotent on the target tier, so a
    // retried request does not become a second purchase.
    throw conflict(`This account is already on the ${input.targetTier} tier.`);
  }

  // Ranked so an enterprise account cannot "upgrade" to premium. Downgrades are
  // refused for the same reason a payment system would: a proration refund is a
  // policy question this build has no answer to.
  if (rankTier(input.targetTier) <= rankTier(currentTier)) {
    throw badRequest(
      `Cannot move from ${currentTier} to ${input.targetTier}. Only an upgrade to a higher tier is supported here.`,
    );
  }

  const reference = input.reference ?? generateToken(16);

  const provider = getPaymentProvider();

  // Checked before charging rather than inferred from the outcome. A provider
  // that is simply not wired up is a different problem from a declined card, and
  // the two deserve different messages.
  if (!provider.isAvailable()) {
    logger.warn('Upgrade refused: no payment provider configured', {
      accountId,
      provider: provider.name,
    });
    throw paymentFailed(
      'No payment provider is configured for this deployment. No tier change has been made.',
    );
  }

  const outcome = await provider.charge({
    accountId,
    targetTier: input.targetTier,
    currentTier,
    reference,
  });

  if (!outcome.approved) {
    // 402, not 500: the request was understood and refused for a reason the
    // caller can act on, and the account is untouched.
    throw paymentFailed(outcome.reason);
  }

  // An account registered through the users path already has a free row. One
  // created outside that path may not, and `update` on a missing id throws —
  // so the absence of a row is a create rather than a defaulted id.
  const saved = current
    ? await prisma.account_memberships.update({
        where: { id: current.id },
        data: {
          tier: input.targetTier,
          timeStart: new Date(),
          // Clear the expiry. An upgrade revives a lapsed membership rather than
          // leaving a row that says "enterprise" and "expired" at once.
          timeEnd: null,
        },
        select: { id: true, accountId: true, tier: true, timeStart: true, timeEnd: true },
      })
    : await prisma.account_memberships.create({
        data: {
          accountId,
          tier: input.targetTier,
          timeStart: new Date(),
          timeEnd: null,
        },
        select: { id: true, accountId: true, tier: true, timeStart: true, timeEnd: true },
      });

  logger.info('Membership upgraded', {
    accountId,
    from: currentTier,
    to: input.targetTier,
    reference,
  });

  return {
    membershipId: saved.id,
    accountId: saved.accountId ?? accountId,
    tier: saved.tier,
    timeStart: saved.timeStart,
    timeEnd: saved.timeEnd,
    isExpired: false,
  };
}

function rankTier(tier: MembershipTier): number {
  switch (tier) {
    case MembershipTier.free:
      return 0;
    case MembershipTier.premium:
      return 1;
    case MembershipTier.enterprise:
      return 2;
    // An unrecognised tier outranks everything, so it cannot be "upgraded" past
    // by accident. Membership validation refuses those separately.
    default:
      return 3;
  }
}