import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { generateFamilyId, generateToken, hashToken } from '../../lib/crypto.js';
import { needsRehash, verifyPassword } from '../../lib/password.js';
import { signAccessToken, type IssuedAccessToken } from '../../lib/tokens.js';
import { assertAccountUsable, loadOrgRoles } from '../../lib/claims.js';
import { forbidden, invalidCredentials, tokenExpired, tokenInvalid, unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Session lifecycle.
 *
 * Access tokens are stateless and short-lived; refresh tokens are stateful,
 * opaque, hashed at rest, and rotate on every use. Rotation is the part worth
 * reading carefully, because it is what turns a stolen token from a permanent
 * key into a detectable event.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
  tokenType: 'Bearer';
}

export interface AuthenticatedAccount {
  accountId: number;
  email: string;
  type: string;
}

/** Issues an access token plus a fresh refresh token, opening a new family. */
async function issueTokenPair(
  accountId: number,
  accountType: string,
  accountStatus: string,
  authMethod: 'password' | 'web3',
  familyId?: string,
): Promise<TokenPair> {
  const orgRoles = await loadOrgRoles(accountId);

  const access: IssuedAccessToken = signAccessToken({
    sub: String(accountId),
    accountId,
    accountType,
    accountStatus,
    orgRoles,
    authMethod,
  });

  const rawRefreshToken = generateToken(32);
  const expiresAt = new Date(Date.now() + config.auth.refreshTtlSeconds * 1000);

  await prisma.refresh_tokens.create({
    data: {
      accountId,
      tokenHash: hashToken(rawRefreshToken),
      // A rotation keeps the family id it was issued under, so the whole
      // lineage stays revocable as one unit.
      familyId: familyId ?? generateFamilyId(),
      expiresAt,
    },
  });

  return {
    accessToken: access.token,
    refreshToken: rawRefreshToken,
    accessTokenExpiresIn: access.expiresIn,
    refreshTokenExpiresAt: expiresAt,
    tokenType: 'Bearer',
  };
}

/**
 * Email and password → a token pair.
 *
 * A wrong email and a wrong password produce the same error, and the password
 * check runs against a dummy hash when the account does not exist. Both are
 * there for the same reason: a distinguishable "no such user" response turns
 * login into an account-enumeration oracle.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ tokens: TokenPair; account: AuthenticatedAccount }> {
  const normalizedEmail = email.trim().toLowerCase();

  const record = await prisma.account_emails.findFirst({
    where: { email: normalizedEmail },
    select: {
      id: true,
      accountId: true,
      isVerified: true,
      account: {
        select: {
          id: true,
          type: true,
          status: true,
          credentials: { select: { passwordHash: true } },
        },
      },
    },
  });

  // No account, or an account with no password set (a wallet-only account).
  // Either way, spend comparable time so the response time does not leak it.
  if (!record?.account) {
    await burnTime();
    throw invalidCredentials();
  }

  const credentials = record.account.credentials;
  if (!credentials) {
    await burnTime();
    throw invalidCredentials();
  }

  const valid = await verifyPassword(credentials.passwordHash, password);
  if (!valid) {
    throw invalidCredentials();
  }

  assertAccountUsable(record.account.status);

  // An unverified address cannot hold a session, or registration would be a
  // way to get a token for an address nobody has proven they control.
  if (!record.isVerified) {
    throw forbidden('Verify your email address before signing in.');
  }

  // Opportunistic upgrade: argon2 stores its own parameters in the hash, so a
  // hash made under older settings still verifies and can be re-hashed here,
  // while the plaintext happens to be available.
  if (needsRehash(credentials.passwordHash)) {
    const { hashPassword } = await import('../../lib/password.js');
    const upgraded = await hashPassword(password);
    await prisma.account_credentials.update({
      where: { accountId: record.account.id },
      data: { passwordHash: upgraded },
    });
    logger.info('Rehashed password under current parameters', {
      accountId: record.account.id,
    });
  }

  const tokens = await issueTokenPair(
    record.account.id,
    record.account.type,
    record.account.status,
    'password',
  );

  return {
    tokens,
    account: {
      accountId: record.account.id,
      email: record.email,
      type: record.account.type,
    },
  };
}

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * The reuse branch is the important one. Presenting a token that is already
 * revoked means either the client replayed it or somebody stole it, and the two
 * are indistinguishable from here. OAuth's answer is to assume theft and revoke
 * the entire family — including the token the legitimate client is currently
 * holding, which forces a fresh login. That costs the honest client one
 * re-authentication; it costs a thief the whole stolen lineage.
 */
export async function refresh(rawRefreshToken: string): Promise<TokenPair> {
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await prisma.refresh_tokens.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      accountId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      replacedBy: true,
      account: { select: { type: true, status: true } },
    },
  });

  if (!stored) {
    throw tokenInvalid('Refresh token is not recognised.');
  }

  if (stored.revokedAt !== null) {
    // Already rotated or explicitly logged out. Treat as compromise.
    await revokeFamily(stored.familyId, 'reuse');
    logger.warn('Refresh token reuse detected, family revoked', {
      accountId: stored.accountId,
      familyId: stored.familyId,
    });
    throw unauthorized('Refresh token has already been used. Please sign in again.');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw tokenExpired('Refresh token has expired. Please sign in again.');
  }

  assertAccountUsable(stored.account.status);

  const next = await issueTokenPair(
    stored.accountId,
    stored.account.type,
    stored.account.status,
    'password',
    stored.familyId,
  );

  // Mark the presented token spent, pointing at its replacement so the lineage
  // is walkable in an audit. `replacedBy` holds the new token's id, which is
  // looked up from its hash.
  const replacement = await prisma.refresh_tokens.findUnique({
    where: { tokenHash: hashToken(next.refreshToken) },
    select: { id: true },
  });

  await prisma.refresh_tokens.update({
    where: { id: stored.id },
    data: {
      revokedAt: new Date(),
      replacedBy: replacement?.id ?? null,
    },
  });

  return next;
}

/**
 * Revokes one token, or the whole family when `allSessions` is set.
 *
 * Revoking the family is what "sign out everywhere" means, and it is the only
 * way to cut a session short given that access tokens cannot be revoked.
 */
export async function logout(
  rawRefreshToken: string | undefined,
  allSessions: boolean,
): Promise<void> {
  if (!rawRefreshToken) return;

  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refresh_tokens.findUnique({
    where: { tokenHash },
    select: { id: true, familyId: true, accountId: true },
  });

  // An unknown token on logout is not an error. The caller's intent — end this
  // session — is satisfied either way, and reporting failure would leak whether
  // the token was ever valid.
  if (!stored) return;

  if (allSessions) {
    await revokeFamily(stored.familyId, 'logout_all');
    return;
  }

  await prisma.refresh_tokens.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every live token in a family. */
async function revokeFamily(familyId: string, reason: string): Promise<void> {
  const { count } = await prisma.refresh_tokens.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  logger.info('Refresh token family revoked', { familyId, reason, revoked: count });
}

/** Revokes every live session for an account — used when a password changes. */
export async function revokeAllSessions(accountId: number, reason: string): Promise<void> {
  const families = await prisma.refresh_tokens.findMany({
    where: { accountId, revokedAt: null },
    select: { familyId: true },
    distinct: ['familyId'],
  });

  for (const { familyId } of families) {
    await revokeFamily(familyId, reason);
  }
}

/**
 * Burns roughly the time a real argon2 verify would take, so a login for a
 * non-existent account is not measurably faster than one for an existing
 * account. Without this, response time alone enumerates accounts.
 */
async function burnTime(): Promise<void> {
  const { hashPassword } = await import('../../lib/password.js');
  await hashPassword('timing-equalizer-not-a-real-password');
}
