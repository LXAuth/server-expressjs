import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '../config.js';
import { tokenExpired, tokenInvalid } from './errors.js';

/**
 * Access tokens.
 *
 * The design constraint from the brief is that `POST /auth/verify-token` does no
 * database lookup on the happy path, because every internal microservice calls
 * it and a per-call query turns the identity provider into the bottleneck it was
 * meant to remove. So everything `verify-token` needs to answer lives in the
 * claims: the account, its type, its status, and its organization roles.
 *
 * The cost of that choice is that an access token cannot be revoked before it
 * expires. Hence the 15-minute default. Revocation happens at refresh time, and
 * a deleted or suspended account is caught by its short token lifetime plus the
 * status claim.
 */

export interface AccessTokenClaims {
  /** The account this token acts as. */
  sub: string;
  accountId: number;
  accountType: string;
  accountStatus: string;
  /** Organization id → role. The empty object is common and stays small. */
  orgRoles: Record<string, string>;
  /** Set when the session began with a wallet signature rather than a password. */
  authMethod?: 'password' | 'web3';
  /**
   * The token's own expiry, in seconds since the epoch, from the registered
   * `exp` claim. Carried in the claims so a caller that verified a token can
   * report when it lapses without decoding it again.
   */
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
  expiresAt: Date;
}

export function signAccessToken(claims: AccessTokenClaims): IssuedAccessToken {
  const expiresIn = config.auth.accessTtlSeconds;

  const token = jwt.sign(
    {
      accountType: claims.accountType,
      accountStatus: claims.accountStatus,
      orgRoles: claims.orgRoles,
      ...(claims.authMethod === undefined ? {} : { authMethod: claims.authMethod }),
    },
    config.auth.accessSecret,
    {
      subject: String(claims.accountId),
      expiresIn,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      algorithm: 'HS256',
    },
  );

  return {
    token,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

/**
 * Verifies an access token's signature and lifetime.
 *
 * Throws `tokenExpired` or `tokenInvalid` rather than returning a boolean, so a
 * caller cannot forget to check. The distinction matters to a client: an expired
 * token means refresh and retry, an invalid one means re-authenticate.
 *
 * The algorithm is pinned. Accepting whatever the token's header claims is the
 * `alg: none` vulnerability, and letting a token choose between HS256 and RS256
 * is the same class of problem.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  let payload: JwtPayload;

  try {
    payload = jwt.verify(token, config.auth.accessSecret, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw tokenExpired();
    }
    throw tokenInvalid();
  }

  const accountId = Number.parseInt(String(payload.sub ?? ''), 10);
  if (!Number.isInteger(accountId)) {
    throw tokenInvalid('Token subject is not a valid account id.');
  }

  const orgRoles = payload.orgRoles;
  if (typeof orgRoles !== 'object' || orgRoles === null || Array.isArray(orgRoles)) {
    throw tokenInvalid('Token organization claims are malformed.');
  }

  return {
    sub: String(payload.sub),
    accountId,
    accountType: typeof payload.accountType === 'string' ? payload.accountType : 'user',
    accountStatus: typeof payload.accountStatus === 'string' ? payload.accountStatus : 'active',
    orgRoles: orgRoles as Record<string, string>,
    // jwt.verify only returns a payload carrying `exp` when the token has not
    // expired, so this is always present here.
    exp: payload.exp as number,
    ...(typeof payload.authMethod === 'string'
      ? { authMethod: payload.authMethod as 'password' | 'web3' }
      : {}),
  };
}

/**
 * The response shape `verify-token` returns to a calling microservice.
 *
 * `permissions` is derived from the org roles rather than looked up, which is
 * the whole point of this endpoint — the caller gets its answer without the
 * database being involved at all.
 */
export interface VerifyTokenResult {
  valid: true;
  accountId: number;
  accountType: string;
  accountStatus: string;
  permissions: string[];
  organizations: Array<{ organizationId: number; role: string }>;
  expiresAt: number;
}

/**
 * Permissions are namespaced so a caller can check one without parsing a role:
 *
 *   org:{id}:read     org:{id}:write    org:{id}:delete
 *   org:{id}:members  org:{id}:teams
 *   account:read      account:write      account:wallets
 *   membership:read   membership:write
 */
export function derivePermissions(
  accountType: string,
  orgRoles: Record<string, string>,
): string[] {
  const permissions = new Set<string>(['account:read']);

  if (accountType === 'user') {
    permissions.add('account:write');
    permissions.add('account:wallets');
    permissions.add('membership:read');
    permissions.add('membership:write');
  }

  for (const [organizationId, role] of Object.entries(orgRoles)) {
    permissions.add(`org:${organizationId}:read`);

    // guest can read an organization but holds no management rights, so
    // everything below is gated on more than guest.
    if (role !== 'guest') {
      permissions.add(`org:${organizationId}:write`);
      permissions.add(`org:${organizationId}:teams`);
    }
    if (role === 'admin' || role === 'co_owner' || role === 'owner') {
      permissions.add(`org:${organizationId}:members`);
    }
    // Deletion is narrower than administration, so only the owner gets it.
    if (role === 'owner') {
      permissions.add(`org:${organizationId}:delete`);
    }
  }

  return [...permissions].sort();
}

export function buildVerifyTokenResult(claims: AccessTokenClaims): VerifyTokenResult {
  return {
    valid: true,
    accountId: claims.accountId,
    accountType: claims.accountType,
    accountStatus: claims.accountStatus,
    permissions: derivePermissions(claims.accountType, claims.orgRoles),
    organizations: Object.entries(claims.orgRoles).map(([organizationId, role]) => ({
      organizationId: Number.parseInt(organizationId, 10),
      role,
    })),
    expiresAt: claims.exp,
  };
}
