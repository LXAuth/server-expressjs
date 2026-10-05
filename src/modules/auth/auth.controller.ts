import type { Request, Response } from 'express';
import * as authService from './auth.service.js';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  verifyTokenSchema,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type VerifyTokenInput,
} from './auth.schemas.js';
import { buildVerifyTokenResult, verifyAccessToken } from '../../lib/tokens.js';
import { logger } from '../../lib/logger.js';

/**
 * Auth handlers.
 *
 * Each one parses, delegates, and shapes the response. No business logic lives
 * here — that is the service's job, so the same rules can be reached from a
 * future CLI or a background job without going through HTTP.
 */

/**
 * `POST /auth/login`
 *
 * Answers 401 with an identical body whether the email is unknown, the password
 * is wrong, or the account has no password. The service also equalises the time
 * taken, so neither the body nor the latency distinguishes them.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;
  const parsed = loginSchema.parse(input);

  const { tokens, account } = await authService.login(parsed.email, parsed.password);

  logger.info('Login succeeded', { accountId: account.accountId });

  res.status(200).json({
    ...tokens,
    account: {
      accountId: account.accountId,
      email: account.email,
      type: account.type,
    },
  });
}

/** `POST /auth/refresh` — rotates the presented token. */
export async function refresh(req: Request, res: Response): Promise<void> {
  const parsed = refreshSchema.parse(req.body as RefreshInput);
  const tokens = await authService.refresh(parsed.refreshToken);
  res.status(200).json(tokens);
}

/**
 * `POST /auth/logout`
 *
 * Always 204, whether or not the token was recognised. Reporting failure would
 * turn this into an oracle for testing whether a token was ever valid.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const parsed = logoutSchema.parse(req.body as LogoutInput ?? {});
  await authService.logout(parsed.refreshToken, parsed.allSessions);
  res.status(204).send();
}

/**
 * `POST /auth/verify-token` — the Zero Trust core.
 *
 * This is the one endpoint every internal microservice calls on each request,
 * so it is a pure function of the token: verify the signature, read the claims,
 * answer. No database query appears on this path, which is what keeps the
 * identity provider from being the bottleneck it was meant to remove.
 *
 * That means the answer reflects the token as issued. An account suspended a
 * second ago still passes until its access token expires — which is why the
 * access token lifetime is 15 minutes and not an hour.
 */
export async function verifyToken(req: Request, res: Response): Promise<void> {
  const parsed = verifyTokenSchema.parse(req.body as VerifyTokenInput);

  // Throws tokenExpired or tokenInvalid, which the error handler maps to 401
  // with a code the caller can branch on: expired means refresh, invalid means
  // re-authenticate.
  const claims = verifyAccessToken(parsed.token);

  res.status(200).json(buildVerifyTokenResult(claims));
}
