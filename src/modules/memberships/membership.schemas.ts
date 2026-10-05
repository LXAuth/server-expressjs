import { z } from 'zod';
import { MembershipTier } from '../../lib/enums.js';

/**
 * Request schemas for the memberships group.
 */

export const upgradeMembershipSchema = z.object({
  targetTier: z.enum(
    [MembershipTier.premium, MembershipTier.enterprise],
    {
      errorMap: () => ({
        message: 'targetTier must be premium or enterprise. Use DELETE to cancel.',
      }),
    },
  ),
  /**
   * Optional client-supplied idempotency key.
   *
   * Passed to the provider so a retried request charges once. Not trusted as a
   * uniqueness guarantee on its own — the server also keys the attempt row.
   */
  reference: z.string().trim().min(1).max(128).optional(),
});

export type UpgradeMembershipInput = z.infer<typeof upgradeMembershipSchema>;