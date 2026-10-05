import { z } from 'zod';

/**
 * Request schemas for the wallets group.
 */

const chain = z.string().trim().toLowerCase().min(1).max(50).default('ethereum');
const address = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte hex address.');
const signature = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]+$/, 'Must be a 0x-prefixed hex signature.')
  .max(1024);
const nonce = z.string().trim().min(1).max(128);

/**
 * `POST /accounts/{account_id}/wallets/nonce`
 *
 * `address` is required, not optional. The challenge message embeds the address,
 * and a message naming a placeholder would be one the client cannot sign and the
 * server could not later match. Requiring it here means the client is handed
 * text it can actually sign.
 */
export const bindNonceSchema = z.object({
  chain,
  address,
});

/**
 * `POST /accounts/{account_id}/wallets/bind`
 *
 * A signature is required, and there is no path to binding a wallet without one.
 * The nonce must have been issued for this account — a login challenge carries
 * no account id and is refused here.
 */
export const bindWalletSchema = z.object({
  chain,
  address,
  nonce,
  signature,
});

export type BindNonceInput = z.infer<typeof bindNonceSchema>;
export type BindWalletInput = z.infer<typeof bindWalletSchema>;