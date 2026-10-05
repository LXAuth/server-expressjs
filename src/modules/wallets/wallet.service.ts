import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { generateNonce } from '../../lib/crypto.js';
import {
  buildWalletBindMessage,
  isRecoveryAvailable,
  normalizeAddress,
  verifyPersonalSignature,
} from '../../lib/signature.js';
import {
  conflict,
  forbidden,
  notFound,
  signatureUnavailable,
  tokenInvalid,
  unauthorized,
} from '../../lib/errors.js';
import { AccountType, OrgRole } from '../../lib/enums.js';
import { requireOrgRole } from '../../lib/claims.js';
import { logger } from '../../lib/logger.js';

/**
 * Wallets bound to an account.
 *
 * `wallets.account_id` is nullable and points at `accounts`, not at `users` — so
 * a wallet can front a user, an organization, or an agent. That is why these
 * routes are mounted under `/accounts/{account_id}` and why every operation has
 * to work out who is allowed to touch a given account rather than assuming the
 * caller is the owner.
 */

export interface BindNonce {
  nonce: string;
  chain: string;
  expiresAt: Date;
  message: string;
}

/**
 * Confirms the actor may manage wallets on this account.
 *
 * Two cases, because an account is not always a user:
 *
 * * a **user** account — the actor must be that user. Nobody else may bind a
 *   wallet to someone's account, not even an administrator.
 * * an **organization** account — the actor must hold `owner` or `co_owner`.
 *   `admin` is deliberately below the bar: binding a wallet is how an
 *   organization would prove who controls it, so it is held at the same level
 *   as moving money out of it.
 *
 * A deleted account is refused outright rather than treated as a user, because
 * `wallets.account_id` cascades on delete only for a hard delete and a soft
 * delete leaves the row in place.
 */
export async function requireWalletAdmin(
  actorAccountId: number,
  accountId: number,
): Promise<void> {
  const account = await prisma.accounts.findUnique({
    where: { id: accountId },
    select: { id: true, type: true, status: true },
  });

  if (!account) {
    throw notFound('Account', accountId);
  }

  if (account.status === 'deleted') {
    throw notFound('Account', accountId);
  }

  if (account.type === AccountType.user) {
    if (actorAccountId !== accountId) {
      throw forbidden('You can only manage your own wallets.');
    }
    return;
  }

  if (account.type === AccountType.organization) {
    // `requireOrgRole` refuses a non-member outright and validates the stored
    // role against the enum set. `co_owner` is the bar because it ranks below
    // `owner`, so this admits owners too.
    await requireOrgRole(actorAccountId, accountId, OrgRole.co_owner);
    return;
  }

  // An agent account has no membership table and no self-service path in this
  // build, so there is no role that would authorise this.
  throw forbidden('Wallets cannot be managed on this account type.');
}

/**
 * Issues a challenge for binding a wallet to an account.
 *
 * Distinct from the login challenge in `web3.service`: this one records the
 * account it is for, and `bindWallet` refuses a challenge that does not match.
 * Without that, a challenge — and therefore a signature over it — could be
 * replayed against any account.
 */
export async function issueBindNonce(
  accountId: number,
  chain: string,
  walletAddress: string,
): Promise<BindNonce> {
  if (!isRecoveryAvailable()) {
    throw signatureUnavailable(
      'Wallet binding is not available in this deployment: no secp256k1 recovery implementation is installed.',
    );
  }

  const normalized = normalizeAddress(walletAddress);
  if (!normalized) {
    throw tokenInvalid('Address is not a valid 20-byte hex value.');
  }

  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + config.web3.nonceTtlSeconds * 1000);

  await prisma.web3_nonces.create({
    data: { nonce, chain, expiresAt, accountId },
  });

  // `bindWallet` rebuilds this exact text from stored state, so what the client
  // signs here and what the server reconstructs cannot drift.
  return {
    nonce,
    chain,
    expiresAt,
    message: buildWalletBindMessage({
      domain: config.web3.domain,
      address: normalized,
      chain,
      accountId,
      nonce,
      issuedAt: expiresAt.toISOString(),
    }),
  };
}

/**
 * Binds a wallet, having proved control of the key.
 *
 * Three conditions, all necessary:
 *
 * * the signature verifies against the address being bound, so the caller holds
 *   the private key;
 * * the challenge was issued for *this* account, so a signature captured while
 *   binding one account cannot be replayed onto another;
 * * the address is not already bound anywhere — `wallet_address` is globally
 *   unique, so one key cannot front two accounts.
 */
export async function bindWallet(
  accountId: number,
  chain: string,
  claimedAddress: string,
  nonce: string,
  signature: string,
): Promise<{ walletId: number; address: string; chain: string; isPrimary: boolean }> {
  if (!isRecoveryAvailable()) {
    throw signatureUnavailable(
      'Wallet binding is not available in this deployment: no secp256k1 recovery implementation is installed.',
    );
  }

  const expected = normalizeAddress(claimedAddress);
  if (!expected) {
    throw tokenInvalid('Address is not a valid 20-byte hex value.');
  }

  const challenge = await prisma.web3_nonces.findUnique({
    where: { nonce },
    select: { chain: true, accountId: true, expiresAt: true, consumedAt: true },
  });

  // Unknown, wrong chain, expired, consumed, and issued for another account all
  // collapse into one error. Which of those it was tells an attacker how far a
  // replay attempt got.
  if (
    !challenge ||
    challenge.chain !== chain ||
    challenge.consumedAt !== null ||
    challenge.expiresAt.getTime() <= Date.now()
  ) {
    throw tokenInvalid('Nonce is not recognised, has expired, or has already been used.');
  }

  if (challenge.accountId !== accountId) {
    throw tokenInvalid('Nonce is not recognised, has expired, or has already been used.');
  }

  // Rebuilt from stored state, never taken from the request. If the client could
  // supply the text it signed, it could sign text that binds nothing.
  const message = buildWalletBindMessage({
    domain: config.web3.domain,
    address: expected,
    chain,
    accountId,
    nonce,
    issuedAt: challenge.expiresAt.toISOString(),
  });

  const verified = verifyPersonalSignature(expected, message, signature);
  if (!verified.valid) {
    // Left unconsumed on failure, as in the login path: a failed signature is
    // more likely a wrong wallet than an attack, and burning the challenge would
    // make the correction a restart.
    throw unauthorized(verified.reason ?? 'Signature verification failed.');
  }

  // The conditional update is the single-use guarantee. Two concurrent binds
  // with the same signature produce one winner.
  const { count } = await prisma.web3_nonces.updateMany({
    where: { nonce, chain, accountId, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  if (count !== 1) {
    throw conflict('This nonce has already been used or has expired.');
  }

  const existing = await prisma.wallets.findUnique({
    where: { walletAddress: expected },
    select: { id: true, accountId: true },
  });

  if (existing) {
    throw conflict(
      existing.accountId === accountId
        ? 'This wallet is already bound to your account.'
        : 'This wallet is already bound to another account.',
    );
  }

  // The first wallet on an account becomes its primary. Otherwise an account
  // whose wallets were all unbound would be left with none, and "primary" would
  // quietly stop meaning anything.
  const walletCount = await prisma.wallets.count({ where: { accountId } });

  try {
    const wallet = await prisma.wallets.create({
      data: {
        accountId,
        walletAddress: expected,
        chain,
        isPrimary: walletCount === 0,
      },
      select: { id: true, walletAddress: true, chain: true, isPrimary: true },
    });

    logger.info('Wallet bound', {
      accountId,
      walletId: wallet.id,
      address: expected,
      chain,
    });

    return {
      walletId: wallet.id,
      address: wallet.walletAddress,
      chain: wallet.chain,
      isPrimary: wallet.isPrimary,
    };
  } catch (error) {
    // Two binds of the same address can both read "not bound" above. The unique
    // constraint is what actually decides, so this reports the real outcome
    // rather than a 500 for what is an ordinary conflict.
    if (isUniqueViolation(error)) {
      throw conflict('This wallet is already bound to an account.');
    }
    throw error;
  }
}

/** `GET /accounts/{account_id}/wallets` */
export async function listWallets(accountId: number) {
  const wallets = await prisma.wallets.findMany({
    where: { accountId },
    select: {
      id: true,
      walletAddress: true,
      chain: true,
      isPrimary: true,
      createdAt: true,
    },
    // Primary first, then oldest, so the ordering is obvious and stable.
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  return wallets.map((wallet) => ({
    walletId: wallet.id,
    address: wallet.walletAddress,
    chain: wallet.chain,
    isPrimary: wallet.isPrimary,
    createdAt: wallet.createdAt,
  }));
}

/**
 * Replaces the primary wallet.
 *
 * Demote-then-promote, in one transaction. The order is forced by
 * `one_primary_wallet_per_account`: promoting first would briefly give the
 * account two primaries, and the index would reject the transaction.
 */
export async function setPrimaryWallet(
  accountId: number,
  walletId: number,
): Promise<{ walletId: number; isPrimary: true }> {
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallets.findUnique({
      where: { id: walletId },
      select: { id: true, accountId: true },
    });

    // Scoped to the account as well as the id. Without the account filter,
    // `GET /accounts/12/wallets/7` could mark organization 2's wallet primary.
    if (!wallet || wallet.accountId !== accountId) {
      throw notFound('Wallet', walletId);
    }

    await tx.wallets.updateMany({
      where: { accountId, isPrimary: true },
      data: { isPrimary: false },
    });

    await tx.wallets.update({
      where: { id: walletId },
      data: { isPrimary: true },
    });
  });

  logger.info('Primary wallet changed', { accountId, walletId });

  return { walletId, isPrimary: true };
}

/**
 * Unbinds a wallet.
 *
 * Removing the primary promotes the oldest remaining wallet, so an account is
 * never left with wallets but none of them primary. Removing the *last* wallet
 * is allowed: an account with a password can bind another, and refusing would
 * leave an unbindable account permanently.
 */
export async function unbindWallet(accountId: number, walletId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallets.findUnique({
      where: { id: walletId },
      select: { id: true, accountId: true, isPrimary: true },
    });

    if (!wallet || wallet.accountId !== accountId) {
      throw notFound('Wallet', walletId);
    }

    await tx.wallets.delete({ where: { id: walletId } });

    if (!wallet.isPrimary) return;

    const successor = await tx.wallets.findFirst({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (successor) {
      await tx.wallets.update({
        where: { id: successor.id },
        data: { isPrimary: true },
      });
    }
  });

  logger.info('Wallet unbound', { accountId, walletId });
}

/**
 * Prisma's code for a unique constraint violation. Checked rather than matched
 * on message text, because the code is part of the contract and the message is
 * not.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}