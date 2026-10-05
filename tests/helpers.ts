import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Shared test helpers.
 *
 * The app is built once per file. `createApp` has no side effects, so this does
 * not open a port and does not reach the database until a request does.
 */

export const app: Express = createApp();

/** A registered, email-verified user with a live session. */
export interface TestUser {
  accountId: number;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

/**
 * Registers a user and verifies their email.
 *
 * Uniqueness comes from a per-call counter rather than a random string, so a
 * failure names the call that caused it.
 */
export async function createUser(overrides: { email?: string; nameId?: string } = {}): Promise<TestUser> {
  counter += 1;
  const unique = `${process.pid}-${counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = overrides.email ?? `user-${unique}@example.test`;
  const password = 'correct-horse-battery-staple-99';
  const nameId = overrides.nameId ?? `@user${unique.replace(/-/g, '')}`;

  const registered = await request(app)
    .post('/api/v1/users/register')
    .send({ email, password, nameId });

  if (registered.status !== 201) {
    throw new Error(
      `register failed in helper: ${registered.status} ${JSON.stringify(registered.body)}`,
    );
  }

  const accountId: number = registered.body.accountId;

  // The verification token comes back in the response because this build has no
  // mail transport. Marking it used rather than redeeming it would leave the
  // helper testing less than a real client does.
  await request(app)
    .post('/api/v1/users/me/emails/verify')
    .send({ token: registered.body.verificationToken })
    .set('Authorization', `Bearer ${await accessTokenFor(accountId)}`);

  const login = await request(app).post('/api/v1/auth/login').send({ email, password });

  if (login.status !== 200) {
    throw new Error(`login failed in helper: ${login.status} ${JSON.stringify(login.body)}`);
  }

  return {
    accountId,
    email,
    password,
    accessToken: login.body.accessToken,
    refreshToken: login.body.refreshToken,
  };
}

/**
 * Mints an access token for an account directly.
 *
 * Used to verify an email before login, since verification needs a session and
 * the account cannot log in until its email is verified. Going through the login
 * path here would be circular.
 */
async function accessTokenFor(accountId: number): Promise<string> {
  const { signAccessToken } = await import('../src/lib/tokens.js');
  const { loadOrgRoles } = await import('../src/lib/claims.js');

  const account = await prisma.accounts.findUniqueOrThrow({
    where: { id: accountId },
    select: { type: true, status: true },
  });

  return signAccessToken({
    sub: String(accountId),
    accountId,
    accountType: account.type,
    accountStatus: account.status,
    orgRoles: await loadOrgRoles(accountId),
  }).token;
}

/** An authorization header for a user. */
export function bearer(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}

/**
 * An organization owned by `user`.
 *
 * Owner is written in the same transaction as the organization, so the returned
 * id always has exactly one owner — which is what the owner-invariant tests
 * need as their starting point.
 */
export async function createOrganization(user: TestUser, nameId?: string): Promise<number> {
  counter += 1;
  const unique = nameId ?? `@org${process.pid}${counter}`;

  const created = await request(app)
    .post('/api/v1/organizations')
    .set('Authorization', bearer(user))
    .send({ nameId: unique, nameDisplay: unique.replace(/^@/, '') });

  if (created.status !== 201) {
    throw new Error(
      `createOrganization failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }

  return created.body.organizationId as number;
}

/** Removes every row. Called between tests that share a file. */
export async function resetDatabase(): Promise<void> {
  // Ordered child-first, or the deletes fail on their own foreign keys.
  await prisma.web3_nonces.deleteMany();
  await prisma.organization_invites.deleteMany();
  await prisma.organization_team_members.deleteMany();
  await prisma.organization_teams.deleteMany();
  await prisma.organization_members.deleteMany();
  await prisma.wallets.deleteMany();
  await prisma.account_addresses.deleteMany();
  await prisma.account_emails.deleteMany();
  await prisma.account_email_verifications.deleteMany();
  await prisma.account_credentials.deleteMany();
  await prisma.refresh_tokens.deleteMany();
  await prisma.account_memberships.deleteMany();
  await prisma.account_properties.deleteMany();
  await prisma.accounts.deleteMany();
}

/** A syntactically valid address. No key exists for it, which is the point. */
export function fakeAddress(seed: number): string {
  return `0x${seed.toString(16).padStart(40, '0')}`;
}

/**
 * A well-formed but unverifiable 65-byte signature.
 *
 * `r` and `s` are inside the curve order and `s` is in the lower half, so this
 * passes format validation. It recovers nothing, which is what lets the tests
 * check that a structurally valid signature is still refused.
 */
export const validShapeSignature = (): string =>
  `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;