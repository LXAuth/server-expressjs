import { logger } from '../logger.js';
import { MembershipTier } from '../enums.js';

/**
 * The payment boundary.
 *
 * No gateway is named in the brief and none is imported here. What exists is the
 * interface a gateway would have to satisfy, and one implementation that does
 * nothing — so the upgrade path is wired and testable without a vendor account,
 * a webhook secret, or an SDK.
 *
 * The important property is that a `NoopPaymentProvider` **approves nothing and
 * still records an attempt**. A provider that silently succeeds is how a system
 * ends up handing out enterprise tiers for free; this one refuses to move a tier
 * and leaves a record saying why.
 */

export interface UpgradeRequest {
  accountId: number;
  /** The tier being moved to. */
  targetTier: MembershipTier;
  /** What the account is on now. Recorded for the audit trail. */
  currentTier: MembershipTier;
  /** Free-form, opaque to the provider. An idempotency key in a real deployment. */
  reference: string;
}

export type UpgradeOutcome =
  | { approved: true; providerReference: string }
  | { approved: false; reason: string };

export interface PaymentProvider {
  readonly name: string;

  /**
   * Whether this provider can move accounts between tiers at all.
   *
   * Checked before the tier is written, so a deployment with no gateway
   * configured refuses rather than upgrading for free.
   */
  isAvailable(): boolean;

  /**
   * Charges for a tier change.
   *
   * Must be idempotent on `reference`: calling it twice with the same reference
   * has to charge once. A retry after a timeout is the normal case, not the
   * exceptional one.
   */
  charge(request: UpgradeRequest): Promise<UpgradeOutcome>;
}

/**
 * The default provider: declines every upgrade.
 *
 * Deliberately not a fake success. A no-op that returned `approved: true` would
 * make the whole upgrade path look working in development and then fail the first
 * time it met a real customer, because the tier would have been written with no
 * payment behind it.
 */
export class NoopPaymentProvider implements PaymentProvider {
  readonly name = 'noop';

  isAvailable(): boolean {
    return false;
  }

  async charge(request: UpgradeRequest): Promise<UpgradeOutcome> {
    logger.warn('Upgrade declined: no payment provider is configured', {
      accountId: request.accountId,
      from: request.currentTier,
      to: request.targetTier,
    });

    return {
      approved: false,
      reason:
        'No payment provider is configured for this deployment. No tier change has been made.',
    };
  }
}

let provider: PaymentProvider = new NoopPaymentProvider();

/** The active provider. Never null — `NoopPaymentProvider` is the floor. */
export function getPaymentProvider(): PaymentProvider {
  return provider;
}

/**
 * Replaces the provider.
 *
 * Called once at boot by whichever deployment wires a real gateway. Anything
 * calling this per-request would let one request swap the payment provider for
 * the next.
 */
export function setPaymentProvider(next: PaymentProvider): void {
  provider = next;
  logger.info('Payment provider set', { provider: next.name, available: next.isAvailable() });
}