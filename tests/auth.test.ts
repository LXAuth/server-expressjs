import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createUser, resetDatabase, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Registration, login, refresh rotation, and password change.
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

describe('registration', () => {
  it('returns the verification token, because there is no mail transport', async () => {
    const response = await request(app).post('/api/v1/users/register').send({
      email: `fresh-${Math.random()}@example.test`,
      password: 'correct-horse-battery-staple-99',
      nameId: `@fresh${Math.floor(Math.random() * 1e6)}`,
    });

    expect(response.status).toBe(201);
    // An endpoint that produced a token with no way to redeem it would leave
    // verification unreachable, so it is returned here and emailed in a real
    // deployment.
    expect(response.body.verificationToken).toBeTruthy();
  });

  it('refuses a password under 12 characters', async () => {
    const response = await request(app).post('/api/v1/users/register').send({
      email: `short-${Math.random()}@example.test`,
      password: 'elevenchars',
      nameId: `@short${Math.floor(Math.random() * 1e6)}`,
    });

    expect(response.status).toBe(422);
  });

  it('refuses a duplicate email', async () => {
    const response = await request(app).post('/api/v1/users/register').send({
      email: user.email,
      password: 'correct-horse-battery-staple-99',
      nameId: `@dupe${Math.floor(Math.random() * 1e6)}`,
    });

    expect(response.status).toBe(409);
  });
});

describe('login', () => {
  it('returns a token pair for a verified account', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
    expect(response.body.tokenType).toBe('Bearer');
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong-password-entirely' });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password-entirely' });

    // A distinguishable "no such user" turns login into an account-enumeration
    // oracle, so the two must be indistinguishable in the body.
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('refuses an unverified email', async () => {
    const registered = await request(app).post('/api/v1/users/register').send({
      email: `unverified-${Math.random()}@example.test`,
      password: 'correct-horse-battery-staple-99',
      nameId: `@unver${Math.floor(Math.random() * 1e6)}`,
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: registered.body.email, password: 'correct-horse-battery-staple-99' });

    // Otherwise registration is a way to get a session for an address nobody has
    // proven they control.
    expect(login.status).toBe(403);
  });
});

describe('refresh rotation', () => {
  it('issues a new pair and revokes the presented token', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    const first = login.body.refreshToken as string;

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(first);

    const stored = await prisma.refresh_tokens.findMany({
      where: { tokenHash: (await import('../src/lib/crypto.js')).hashToken(first) },
      select: { revokedAt: true, familyId: true },
    });

    expect(stored[0]?.revokedAt).not.toBeNull();
  });

  it('kills the whole family when a revoked token is replayed', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    const original = login.body.refreshToken as string;

    // Rotate once, so `original` becomes a revoked member of a live family.
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: original });

    const current = rotated.body.refreshToken as string;

    // Replay the old token. This is indistinguishable from theft, so the honest
    // client's token dies too.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: original });

    expect(replay.status).toBe(401);

    const familyStillWorks = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: current });

    expect(familyStillWorks.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(response.status).toBe(401);
  });
});

describe('logout', () => {
  it('always answers 204, whether or not the token was recognised', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'never-existed' });

    // Reporting failure would turn logout into an oracle for testing whether a
    // token was ever valid.
    expect(unknown.status).toBe(204);
  });

  it('revokes the session', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });

    const token = login.body.refreshToken as string;

    await request(app).post('/api/v1/auth/logout').send({ refreshToken: token }).expect(204);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: token });

    expect(refreshed.status).toBe(401);
  });
});

describe('password change', () => {
  it('revokes every session and reports how many remain', async () => {
    const local = await createUser();

    // A second session, so the change has something to revoke.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: local.email, password: local.password })
      .expect(200);

    const changed = await request(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', bearer(local))
      .send({ currentPassword: local.password, newPassword: 'a-brand-new-password-77' });

    expect(changed.status).toBe(200);
    // The caller's own session is among those revoked, and it can no longer use
    // the old token to discover that — so the count is in the response.
    expect(changed.body.sessionsRevoked).toBe(0);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: local.email, password: local.password });

    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: local.email, password: 'a-brand-new-password-77' });

    expect(newLogin.status).toBe(200);
  });

  it('refuses when the current password is wrong', async () => {
    const local = await createUser();

    const response = await request(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', bearer(local))
      .send({ currentPassword: 'not-the-password', newPassword: 'a-brand-new-password-77' });

    expect(response.status).toBe(400);
  });

  it('refuses a new password identical to the old one', async () => {
    const local = await createUser();

    const response = await request(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', bearer(local))
      .send({ currentPassword: local.password, newPassword: local.password });

    expect(response.status).toBe(400);
  });
});

describe('authorization', () => {
  it('requires a token on a protected route', async () => {
    const response = await request(app).get('/api/v1/users/me');
    expect(response.status).toBe(401);
  });

  it('refuses a malformed Authorization header specifically', async () => {
    // "Missing" and "wrong scheme" are different client bugs and worth
    // distinguishing.
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Basic abc123');

    expect(response.status).toBe(401);
    expect(response.body.error.message).toContain('Bearer');
  });
});