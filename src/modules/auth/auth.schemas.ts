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

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
