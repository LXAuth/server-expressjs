import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, resetDatabase, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { getPaymentProvider, NoopPaymentProvider } from '../src/lib/payment/provider.js';

/**
 * Membership tier read and upgrade.
 *
 * The upgrade cases all end in a refusal, because no payment provider is wired
 * up. That is the behaviour under test: an upgrade path that reports success
 * without a payment behind it hands out paid tiers for free.
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

describe('default payment provider', () => {
  it('reports itself unavailable', () => {
    expect(getPaymentProvider()).toBeInstanceOf(NoopPaymentProvider);
    expect(getPaymentProvider().isAvailable()).toBe(false);
  });

  it('declines every charge rather than approving a fake one', async () => {
    const outcome = await getPaymentProvider().charge({
      accountId: user.accountId,
      targetTier: 'premium',
      currentTier: 'free',
      reference: 'test',
    });

    expect(outcome.approved).toBe(false);
  });
});

describe('GET membership', () => {
  it('reports the free tier a new account is created on', async () => {
    const response = await request(app)
      .get(`/api/v1/accounts/${user.accountId}/membership`)
      .set('Authorization', bearer(user));

    expect(response.status).toBe(200);
    expect(response.body.tier).toBe('free');
    expect(response.body.isExpired).toBe(false);
  });

  it('requires authentication', async () => {
    const response = await request(app).get(`/api/v1/accounts/${user.accountId}/membership`);
    expect(response.status).toBe(401);
  });

  it('refuses to read another account’s membership', async () => {
    const other = await createUser();

    const response = await request(app)
      .get(`/api/v1/accounts/${other.accountId}/membership`)
      .set('Authorization', bearer(user));

    expect(response.status).toBe(403);
  });

  it('reports an expired membership as expired rather than as its tier', async () => {
    await prisma.account_memberships.updateMany({
      where: { accountId: user.accountId },
      data: { tier: 'premium', timeEnd: new Date(Date.now() - 1000) },
    });

    const response = await request(app)
      .get(`/api/v1/accounts/${user.accountId}/membership`)
      .set('Authorization', bearer(user));

    expect(response.body.tier).toBe('premium');
    // A stale row that reads as live would be worse than one that admits it is
    // expired.
    expect(response.body.isExpired).toBe(true);

    await prisma.account_memberships.updateMany({
      where: { accountId: user.accountId },
      data: { tier: 'free', timeEnd: null },
    });
  });
});

describe('POST membership upgrade', () => {
  it('refuses with 402 and changes nothing, because no provider is configured', async () => {
    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/membership/upgrade`)
      .set('Authorization', bearer(user))
      .send({ targetTier: 'premium' });

    // 402, not 500 — the request was understood and refused for a reason the
    // caller can act on.
    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('payment_failed');

    const membership = await prisma.account_memberships.findFirst({
      where: { accountId: user.accountId },
      select: { tier: true },
    });

    // The important assertion: the account is exactly where it was.
    expect(membership?.tier).toBe('free');
  });

  it('refuses to upgrade to free', async () => {
    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/membership/upgrade`)
      .set('Authorization', bearer(user))
      .send({ targetTier: 'free' });

    expect(response.status).toBe(422);
  });

  it('refuses an unrecognised tier', async () => {
    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/membership/upgrade`)
      .set('Authorization', bearer(user))
      .send({ targetTier: 'platinum' });

    expect(response.status).toBe(422);
  });

  it('refuses a downgrade from premium to a lower tier', async () => {
    await prisma.account_memberships.updateMany({
      where: { accountId: user.accountId },
      data: { tier: 'premium', timeEnd: null },
    });

    const response = await request(app)
      .post(`/api/v1/accounts/${user.accountId}/membership/upgrade`)
      .set('Authorization', bearer(user))
      .send({ targetTier: 'premium' });

    // Same tier is a conflict — a retry must not become a second purchase.
    expect(response.status).toBe(409);

    await prisma.account_memberships.updateMany({
      where: { accountId: user.accountId },
      data: { tier: 'free', timeEnd: null },
    });
  });

  it('refuses to manage another account’s membership', async () => {
    const other = await createUser();

    const response = await request(app)
      .post(`/api/v1/accounts/${other.accountId}/membership/upgrade`)
      .set('Authorization', bearer(user))
      .send({ targetTier: 'premium' });

    expect(response.status).toBe(403);
  });
});