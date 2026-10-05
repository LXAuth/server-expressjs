import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, fakeAddress, resetDatabase, validShapeSignature, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { isRecoveryAvailable } from '../src/lib/signature.js';

/**
 * Web3 and wallets.
 *
 * **These tests describe the current build, which cannot verify signatures.**
 * The first two cases are the important ones: they assert that the endpoints
 * refuse with 503 rather than appearing to work. A suite that only tested the
 * happy path would look green while the feature was entirely non-functional.
 *
 * The nonce-consume tests exercise the real database constraint directly, so they
 * hold regardless of whether a recovery library is later installed.
 */

let user: TestUser;

beforeAll(async () => {
  await resetDatabase();
  user = await createUser();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('current deployment state', () => {
  it('has no recovery implementation installed', () => {
    // Asserted rather than assumed. If someone wires one up, this test fails and
    // forces the rest of this file to be revisited — which is correct, because
    // the cases below would then be asserting the wrong thing.
    expect(isRecoveryAvailable()).toBe(false);
  });
});

describe('web3 nonce', () => {
  it('refuses to issue a challenge it could never verify', async () => {
    const response = await request(app)
      .post('/api/v1/auth/web3/nonce')
      .send({ chain: 'ethereum', address: fakeAddress(1) });

    // 503, not 201. Handing out a challenge the client would walk away with and
    // fail to redeem turns a deployment gap into a client-side bug report.
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('signature_unavailable');
  });

  it('writes no nonce row', async () => {
    const before = await prisma.web3_nonces.count();
    expect(before).toBe(0);
  });
});

describe('web3 login', () => {
  it('refuses rather than pretending to verify', async () => {
    const response = await request(app)
      .post('/api/v1/auth/web3/login')
      .send({
        chain: 'ethereum',
        address: fakeAddress(1),
        nonce: 'whatever',
        signature: validShapeSignature(),
      });

    expect(response.status).toBe(503);
  });

  it('does not issue tokens for an unbound wallet', async () => {
    const before = await prisma.refresh_tokens.count();

    await request(app)
      .post('/api/v1/auth/web3/login')
      .send({
        chain: 'ethereum',
        address: fakeAddress(1),
        nonce: 'whatever',
        signature: validShapeSignature(),
      });

    expect(await prisma.refresh_tokens.count()).toBe(before);
  });
});

describe('signature format validation', () => {
  it('rejects a 64-byte signature at the schema boundary', async () => {
    const response = await request(app)
      .post('/api/v1/auth/web3/login')
      .send({
        chain: 'ethereum',
        address: fakeAddress(1),
        nonce: 'whatever',
        signature: `0x${'11'.repeat(64)}`,
      });

    // Rejected as malformed rather than reaching the 503, because a 64-byte
    // signature is wrong regardless of whether recovery is installed.
    expect(response.status).toBe(422);
  });

  it('rejects a non-hex address', async () => {
    const response = await request(app)
      .post('/api/v1/auth/web3/login')
      .send({
        chain: 'ethereum',
        address: 'not-an-address',
        nonce: 'whatever',
        signature: validShapeSignature(),
      });

    expect(response.status).toBe(422);
  });
});

describe('wallets', () => {
  it('requires authentication', async () => {
    const response = await request(app).get(`/api/v1/accounts/${user.accountId}/wallets`);
    expect(response.status).toBe(401);
  });

  it('refuses to manage another account’s wallets', async () => {
    const other = await createUser();

    const response = await request(app)
      .get(`/api/v1/accounts/${other.accountId}/wallets`)
      .set('Authorization', bearer(user));

    // Not even an administrator may bind a wallet to someone else's account.
    expect(response.status).toBe(403);
  });

  it('lists an empty set for an account with none', async () => {
    const response = await request(app)
      .get(`/api/v1/accounts/${user.accountId}/wallets`)
      .set('Authorization', bearer(user));

    expect(response.status).toBe(200);
    expect(response.body.wallets).toEqual([]);
  });

  it('refuses a bind nonce, since no signature could be verified', async () => {
    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/wallets/nonce`)
      .set('Authorization', bearer(user))
      .send({ chain: 'ethereum', address: fakeAddress(7) });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('signature_unavailable');
  });

  it('refuses to bind without a signature', async () => {
    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/wallets/bind`)
      .set('Authorization', bearer(user))
      .send({ chain: 'ethereum', address: fakeAddress(8) });

    expect(response.status).toBe(422);
  });

  it('refuses to unbind a wallet belonging to another account', async () => {
    const other = await createUser();

    // A wallet id that does not exist is enough here; the point is that the
    // lookup is scoped to the account in the path.
    const response = await request(app)
      .delete(`/api/v1/accounts/${other.accountId}/wallets/999999`)
      .set('Authorization', bearer(user));

    expect(response.status).toBe(403);
  });
});

describe('nonce single-use, enforced by the database', () => {
  it('consumes a nonce exactly once', async () => {
    const nonce = `test-nonce-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    const accountId = user.accountId;

    await prisma.web3_nonces.create({
      data: {
        nonce,
        chain: 'ethereum',
        accountId,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    // This is the exact conditional update `bindWallet` performs.
    const first = await prisma.web3_nonces.updateMany({
      where: { nonce, chain: 'ethereum', accountId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const second = await prisma.web3_nonces.updateMany({
      where: { nonce, chain: 'ethereum', accountId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    expect(first.count).toBe(1);
    // The second matches no row, because `consumedAt: null` is in the filter. A
    // read-then-write would let both succeed.
    expect(second.count).toBe(0);
  });

  it('refuses an expired nonce', async () => {
    const nonce = `expired-${process.pid}-${Math.floor(Math.random() * 1e6)}`;

    await prisma.web3_nonces.create({
      data: {
        nonce,
        chain: 'ethereum',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const consumed = await prisma.web3_nonces.updateMany({
      where: { nonce, chain: 'ethereum', consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    expect(consumed.count).toBe(0);
  });

  it('will not consume a bind nonce as a login nonce', async () => {
    // A bind challenge carries an account id and a login challenge does not. The
    // consume filters on the account id precisely so one cannot be redeemed as
    // the other.
    const nonce = `bind-only-${process.pid}-${Math.floor(Math.random() * 1e6)}`;

    await prisma.web3_nonces.create({
      data: {
        nonce,
        chain: 'ethereum',
        accountId: user.accountId,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    const asLogin = await prisma.web3_nonces.updateMany({
      where: { nonce, chain: 'ethereum', accountId: null, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    expect(asLogin.count).toBe(0);

    const stored = await prisma.web3_nonces.findUnique({
      where: { nonce },
      select: { consumedAt: true },
    });

    expect(stored?.consumedAt).toBeNull();
  });
});

describe('primary wallet uniqueness', () => {
  it('the database refuses two primary wallets on one account', async () => {
    const addressOne = fakeAddress(101);
    const addressTwo = fakeAddress(102);

    await prisma.wallets.create({
      data: { accountId: user.accountId, walletAddress: addressOne, isPrimary: true },
    });

    let rejected = false;
    try {
      await prisma.wallets.create({
        data: { accountId: user.accountId, walletAddress: addressTwo, isPrimary: true },
      });
    } catch {
      rejected = true;
    }

    // From `one_primary_wallet_per_account` in dev-invariant.sql. Without it,
    // demote-then-promote in `setPrimaryWallet` would briefly hold two and the
    // transaction would fail.
    expect(rejected).toBe(true);
  });

  it('allows many non-primary wallets', async () => {
    await prisma.wallets.create({
      data: { accountId: user.accountId, walletAddress: fakeAddress(103), isPrimary: false },
    });

    await prisma.wallets.create({
      data: { accountId: user.accountId, walletAddress: fakeAddress(104), isPrimary: false },
    });

    const nonPrimary = await prisma.wallets.count({
      where: { accountId: user.accountId, isPrimary: false },
    });

    expect(nonPrimary).toBe(2);
  });

  it('refuses the same address bound twice, across accounts', async () => {
    const other = await createUser();

    let rejected = false;
    try {
      await prisma.wallets.create({
        data: { accountId: other.accountId, walletAddress: fakeAddress(101), isPrimary: true },
      });
    } catch {
      rejected = true;
    }

    // `wallet_address` is globally unique, so one key cannot front two accounts.
    expect(rejected).toBe(true);
  });
});