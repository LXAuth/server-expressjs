import { z } from 'zod';

/**
 * Request schemas for the auth group.
 *
 * Every handler parses through one of these before touching the database, so a
 * malformed request costs a 422 and no query.
 */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(256),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
  /** Revoke every session for the account, not just this one. */
  allSessions: z.boolean().default(false),
});

/**
 * `verify-token` takes the token as a body field because internal microservices
 * post JSON rather than setting an Authorization header — they are verifying a
 * token on someone else's behalf, so it is a payload, not their own credential.
 */
export const verifyTokenSchema = z.object({
  token: z.string().min(1).max(4096),
});

export const web3NonceSchema = z.object({
  chain: z.string().trim().toLowerCase().min(1).max(50).default('ethereum'),
  /** The wallet address that will sign, when the caller already knows it. */
  address: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte hex address.')
    .optional(),
});

export const web3LoginSchema = z.object({
  chain: z.string().trim().toLowerCase().min(1).max(50).default('ethereum'),
  address: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte hex address.'),
  nonce: z.string().trim().min(1).max(128),
  signature: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]+$/, 'Must be a 0x-prefixed hex signature.')
    .max(1024),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
export type Web3NonceInput = z.infer<typeof web3NonceSchema>;
export type Web3LoginInput = z.infer<typeof web3LoginSchema>;
