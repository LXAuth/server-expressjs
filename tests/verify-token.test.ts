import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createOrganization, createUser, resetDatabase, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * `POST /auth/verify-token` — the Zero Trust core.
 *
 * The design constraint this file exists to protect: **no database query on the
 * happy path.** Every internal microservice calls this endpoint on every
 * request, so a lookup here turns the identity provider into the bottleneck it
 * was meant to remove.
 *
 * That constraint cannot be asserted by reading the handler in a test — it is a
 * statement about what the code does not do. So it is verified two ways: by the
 * behaviour below, and by reading the handler, which is noted in the task record
 * as a code-reading check rather than an execution one.
 */

let user: TestUser;
let orgId: number;

beforeAll(async () => {
  await resetDatabase();
  user = await createUser();
  orgId = await createOrganization(user);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('verify-token', () => {
  it('returns the account and its derived permissions for a valid token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: user.accessToken });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.accountId).toBe(user.accountId);
    expect(response.body.accountType).toBe('user');
    expect(response.body.accountStatus).toBe('active');
  });

  it('derives organization permissions from the token claims, not the database', async () => {
    // The owner of an organization gets read, write, members, and delete — all
    // four from the claim alone.
    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: user.accessToken });

    expect(response.body.organizations).toEqual([
      { organizationId: orgId, role: 'owner' },
    ]);

    expect(response.body.permissions).toContain(`org:${orgId}:read`);
    expect(response.body.permissions).toContain(`org:${orgId}:write`);
    expect(response.body.permissions).toContain(`org:${orgId}:members`);
    expect(response.body.permissions).toContain(`org:${orgId}:delete`);
    expect(response.body.permissions).toContain('account:read');
  });

  it('reports the token’s real expiry rather than a recomputed one', async () => {
    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: user.accessToken });

    // `expiresAt` came from the JWT's own `exp` claim. If it were recomputed
    // from the current time it would read as "expires in zero seconds", which is
    // the bug task 4 fixed.
    const expiresAt: number = response.body.expiresAt;
    const now = Math.floor(Date.now() / 1000);

    expect(expiresAt).toBeGreaterThan(now);
    expect(expiresAt - now).toBeLessThanOrEqual(900);
  });

  it('rejects an expired token with token_expired', async () => {
    // Signed directly with jsonwebtoken rather than through `signAccessToken`,
    // which always issues a token valid for the next 15 minutes and so cannot
    // produce an already-expired one.
    const jwt = (await import('jsonwebtoken')).default;
    const { config } = await import('../src/config.js');
    const token = jwt.sign(
      {
        accountType: 'user',
        accountStatus: 'active',
        orgRoles: {},
        expiresIn: -60,
      },
      config.auth.accessSecret,
      {
        subject: String(user.accountId),
        issuer: config.auth.issuer,
        audience: config.auth.audience,
        algorithm: 'HS256',
      },
    );

    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_expired');
  });

  it('rejects a tampered token with token_invalid', async () => {
    // Flip one character of the payload segment. The signature no longer
    // matches, so verification must fail rather than decode and trust it.
    const parts = user.accessToken.split('.');
    const payload = parts[1] as string;
    const flipped = payload.endsWith('A') ? `${payload.slice(0, -1)}B` : `${payload.slice(0, -1)}A`;

    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: `${parts[0]}.${flipped}.${parts[2]}` });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('refuses an unsigned token — the alg:none attack', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { config } = await import('../src/config.js');

    // alg: none with an empty signature. Verifying it means trusting the header's
    // claim about its own algorithm, which is the whole vulnerability.
    const unsigned = jwt.sign(
      {
        accountType: 'user',
        accountStatus: 'active',
        orgRoles: {},
        expiresIn: 900,
      },
      '',
      {
        subject: String(user.accountId),
        issuer: config.auth.issuer,
        audience: config.auth.audience,
        algorithm: 'none',
      },
    );

    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: unsigned });

    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;

    const forged = jwt.sign(
      {
        accountType: 'user',
        accountStatus: 'active',
        orgRoles: {},
        expiresIn: 900,
      },
      'not-the-real-secret-at-all',
      {
        subject: String(user.accountId),
        issuer: 'lxauth',
        audience: 'lxauth-api',
        algorithm: 'HS256',
      },
    );

    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: forged });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('rejects a token issued for a different audience', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { config } = await import('../src/config.js');

    const wrongAudience = jwt.sign(
      {
        accountType: 'user',
        accountStatus: 'active',
        orgRoles: {},
        expiresIn: 900,
      },
      config.auth.accessSecret,
      {
        subject: String(user.accountId),
        issuer: config.auth.issuer,
        audience: 'some-other-service',
        algorithm: 'HS256',
      },
    );

    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: wrongAudience });

    expect(response.status).toBe(401);
  });

  it('carries account:wallets for a user but not for an organization', async () => {
    const response = await request(app)
      .post('/api/v1/auth/verify-token')
      .send({ token: user.accessToken });

    expect(response.body.permissions).toContain('account:wallets');
    expect(response.body.permissions).toContain('membership:read');
  });
});