import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/tokens.js';

/**
 * Widens Express's Request with the authenticated actor.
 *
 * A declaration merge rather than an `any` cast: a handler that reads
 * `req.actor` gets the real type, and one that reads it without the middleware
 * having run gets `undefined` at runtime rather than a silent lie.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: AccessTokenClaims;
    }
  }
}

/**
 * Reads the bearer token and verifies it.
 *
 * Accepts the token from the `Authorization: Bearer` header and, as a
 * fallback, from an `access_token` cookie — the cookie exists for browser
 * clients that cannot set a header on a navigation request.
 */
function extractToken(req: Request): string | undefined {
  const header = req.header('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
    // A header that is present but not a Bearer token is a client bug worth
    // reporting precisely rather than as "missing".
    throw unauthorized('Authorization header must use the Bearer scheme.');
  }

  // Cookie fallback for browser clients, which cannot set a header on a
  // top-level navigation. `cookieParser` is mounted in app.ts; without it
  // `req.cookies` is undefined and this is simply absent.
  return req.cookies?.access_token;
}

/**
 * Requires a valid access token. Rejects 401 when there is none.
 *
 * Note what this does *not* do: it does not query the database. The claims in
 * the token are the authorization input, and `accountStatus` carries enough to
 * refuse a suspended account without a lookup. A token issued moments before a
 * suspension therefore remains valid until it expires — which is the deliberate
 * trade for having `verify-token` be a pure function of the token.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractToken(req);
    if (!token) {
      throw unauthorized('No access token provided.');
    }
    req.actor = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attaches the actor when a token is present, but does not require one.
 *
 * For endpoints that are public yet behave differently for a signed-in caller.
 */
export function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const token = extractToken(req);
    if (token) {
      req.actor = verifyAccessToken(token);
    }
  } catch {
    // A bad token on an optional route is simply an anonymous request.
  }
  next();
}

/**
 * Narrows `req.actor` for handlers mounted behind `authenticate`.
 *
 * Express gives no way to tell the type system that a middleware ran, so this is
 * the one place the assertion is made — once, rather than in every handler.
 */
export function requireActor(req: Request): AccessTokenClaims {
  if (!req.actor) {
    throw unauthorized('Authentication required.');
  }
  return req.actor;
}
