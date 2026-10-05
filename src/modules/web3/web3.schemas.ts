import { z } from 'zod';

/**
 * Request schemas for the web3 auth group.
 *
 * The address is format-checked here and normalised again in the service. Two
 * layers because these endpoints are unauthenticated: a rejection at the edge
 * costs no database work, and the service does not assume its input is clean.
 */

const chain = z.string().trim().toLowerCase().min(1).max(50).default('ethereum');
const address = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte hex address.');

export const web3NonceSchema = z.object({
  chain,
  /** The address that will sign, when the caller already knows it. */
  address: address.optional(),
});

export const web3LoginSchema = z.object({
  chain,
  address,
  nonce: z.string().trim().min(1).max(128),
  /**
   * 65 bytes (r, s, v). The length is not enforced here — the signature
   * validator in `src/lib/signature.ts` gives a specific reason for a 64-byte
   * value, which is more useful than a max-length message.
   */
  signature: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]+$/, 'Must be a 0x-prefixed hex signature.')
    .max(1024),
});

export type Web3NonceInput = z.infer<typeof web3NonceSchema>;
export type Web3LoginInput = z.infer<typeof web3LoginSchema>;
