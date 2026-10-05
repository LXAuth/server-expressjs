import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createOrganization, createUser, resetDatabase, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Users, emails, and addresses.
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

describe('GET /users/me', () => {
  it('returns the account with its emails and addresses', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', bearer(user));

    expect(response.status).toBe(200);
    expect(response.body.accountId).toBe(user.accountId);
    expect(response.body.nameId).toMatch(/^@/);
    expect(response.body.emails[0].email).toBe(user.email);
    expect(response.body.emails[0].isVerified).toBe(true);
  });

  it('never returns the password hash', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', bearer(user));

    // The hash lives on a separate table that is not included, but this asserts
    // the property rather than trusting the omission to hold.
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });
});

describe('PUT /users/me', () => {
  it('updates the display name', async () => {
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ nameDisplay: 'Renamed Person' });

    expect(response.status).toBe(200);
    expect(response.body.nameDisplay).toBe('Renamed Person');
  });

  it('refuses an empty update', async () => {
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({});

    expect(response.status).toBe(422);
  });

  it('refuses a non-URL avatar', async () => {
    const response = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ avatarUrl: 'not-a-url' });

    expect(response.status).toBe(422);
  });
});

describe('emails', () => {
  it('has no isPrimary field on add, deliberately', async () => {
    // An unverified address cannot be primary — otherwise an account could
    // demote its real address in favour of an unverified one and lock itself
    // out. Promotion is its own endpoint and requires isVerified.
    const response = await request(app)
      .post('/api/v1/users/me/emails')
      .set('Authorization', bearer(user))
      .send({ email: `second-${Math.random()}@example.test`, isPrimary: true });

    expect(response.status).toBe(422);
  });

  it('adds an email and returns its verification token', async () => {
    const email = `second-${Math.floor(Math.random() * 1e6)}@example.test`;

    const response = await request(app)
      .post('/api/v1/users/me/emails')
      .set('Authorization', bearer(user))
      .send({ email });

    expect(response.status).toBe(201);
    // No mail transport in this build, so the token comes back directly.
    expect(response.body.verificationToken).toBeTruthy();
  });

  it('refuses promoting an unverified address to primary', async () => {
    const added = await prisma.account_emails.findFirst({
      where: { accountId: user.accountId, isVerified: false },
      select: { id: true },
    });

    if (!added) {
      // Nothing unverified to test with. Skipping silently would hide a coverage
      // gap, so this is reported rather than passed over.
      throw new Error('expected an unverified email to exist for this test');
    }

    const response = await request(app)
      .put(`/api/v1/users/me/emails/${added.id}/primary`)
      .set('Authorization', bearer(user))
      .send({});

    expect(response.status).toBe(403);
  });

  it('refuses a duplicate email on the same account', async () => {
    const response = await request(app)
      .post('/api/v1/users/me/emails')
      .set('Authorization', bearer(user))
      .send({ email: user.email });

    expect(response.status).toBe(409);
  });

  it('rejects a malformed verification token', async () => {
    const response = await request(app)
      .post('/api/v1/users/me/emails/verify')
      .set('Authorization', bearer(user))
      .send({ token: 'not-a-real-token' });

    expect(response.status).toBe(401);
  });
});

describe('addresses', () => {
  it('adds an address and makes the first one primary', async () => {
    const local = await createUser();

    const response = await request(app)
      .post('/api/v1/users/me/addresses')
      .set('Authorization', bearer(local))
      .send({ address: '1 Example Street' });

    expect(response.status).toBe(201);

    const addresses = await prisma.account_addresses.findMany({
      where: { accountId: local.accountId },
      select: { isPrimary: true },
    });

    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.isPrimary).toBe(true);
  });
});

describe('GET /users/me/organizations', () => {
  it('lists only the organizations the caller belongs to', async () => {
    const mine = await createOrganization(user, '@mine-org');
    const notMine = await createOrganization(createUser(), '@not-mine-org');

    const response = await request(app)
      .get('/api/v1/users/me/organizations')
      .set('Authorization', bearer(user));

    expect(response.status).toBe(200);

    const ids = response.body.organizations.map(
      (o: { organizationId: number }) => o.organizationId,
    );

    expect(ids).toContain(mine);
    expect(ids).not.toContain(notMine);
  });
});