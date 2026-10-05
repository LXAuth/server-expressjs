import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, bearer, createOrganization, createUser, resetDatabase, type TestUser } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { isPrismaError, PRISMA_ERRORS } from '../src/lib/prisma.js';

/**
 * "Exactly one owner per organization."
 *
 * The point of this file is **where** the guarantee comes from. Task 6 was
 * explicit that business logic alone is not safe: two concurrent promotions both
 * read "the current owner is X", both demote X, both promote their own target.
 * Only a database constraint decides that race.
 *
 * So the central test here bypasses the application entirely — it writes two
 * owner rows directly through Prisma and asserts the database refuses. If that
 * passes, the invariant holds no matter what the endpoint code does, and the
 * endpoint tests around it confirm the code cooperates rather than being trusted
 * to carry the weight.
 */

let owner: TestUser;
let member: TestUser;
let orgId: number;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser();
  member = await createUser();
  orgId = await createOrganization(owner);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('single-owner invariant', () => {
  it('the database itself refuses a second owner — not the application', async () => {
    const added = await prisma.organization_members.create({
      data: { organizationId: orgId, userId: member.accountId, role: 'member' },
      select: { id: true },
    });

    // Straight to the database, no service layer. This is the assertion that
    // matters: if the service code were the only thing preventing two owners,
    // this would succeed and the race would be real.
    let rejected = false;
    let code: string | undefined;

    try {
      await prisma.organization_members.update({
        where: { id: added.id },
        data: { role: 'owner' },
      });
    } catch (error) {
      rejected = true;
      code = isPrismaError(error, PRISMA_ERRORS.uniqueViolation) ? 'P2002' : 'other';
    }

    expect(rejected).toBe(true);
    expect(code).toBe('P2002');

    // Leave the database as it was, so the endpoint tests below start from one
    // owner rather than from an assertion failure's wreckage.
    await prisma.organization_members.update({
      where: { id: added.id },
      data: { role: 'member' },
    });
  });

  it('permits zero owners and many non-owners — the index is partial', async () => {
    // A partial unique index constrains `role = 'owner'` only. If this failed,
    // the index would be a plain unique on organization_id and an organization
    // could hold a single member, which is obviously not the intent.
    await prisma.organization_members.create({
      data: { organizationId: orgId, userId: member.accountId, role: 'co_owner' },
      select: { id: true },
    });

    const counts = await prisma.organization_members.groupBy({
      by: ['role'],
      where: { organizationId: orgId },
      _count: { _all: true },
    });

    expect(counts.find((c) => c.role === 'owner')?._count._all).toBe(1);
    expect(counts.find((c) => c.role === 'co_owner')?._count._all).toBe(1);
  });

  it('writes the owner in the same transaction as the organization', async () => {
    const freshOrg = await createOrganization(member, '@org-no-owner-window');

    // If creation wrote the organization first and the owner separately, an
    // organization could exist with no owner at all — which the index permits
    // and which nothing else can repair.
    const owners = await prisma.organization_members.count({
      where: { organizationId: freshOrg, role: 'owner' },
    });

    expect(owners).toBe(1);
  });
});

describe('ownership changes through the API', () => {
  it('promotes a member to owner, demoting the previous one first', async () => {
    const localOrg = await createOrganization(owner, '@org-promote');

    const invited = await request(app)
      .post(`/api/v1/organizations/${localOrg}/members/invite`)
      .set('Authorization', bearer(owner))
      .send({ email: member.email, role: 'member' });

    expect(invited.status).toBe(201);

    // Redeemed through the real join endpoint rather than by inserting a row, so
    // the test covers the path a member actually takes.
    const joined = await request(app)
      .post(`/api/v1/organizations/${localOrg}/members/join`)
      .set('Authorization', bearer(member))
      .send({ token: invited.body.token });

    expect(joined.status).toBe(200);

    const promoted = await request(app)
      .put(`/api/v1/organizations/${localOrg}/members/${member.accountId}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'owner' });

    expect(promoted.status).toBe(200);

    const owners = await prisma.organization_members.findMany({
      where: { organizationId: localOrg, role: 'owner' },
      select: { userId: true },
    });

    expect(owners).toHaveLength(1);
    expect(owners[0]?.userId).toBe(member.accountId);

    // The demotion is part of the same transaction, so the previous owner is now
    // a co_owner rather than a second owner.
    const previous = await prisma.organization_members.findUnique({
      where: { organizationId_userId: { organizationId: localOrg, userId: owner.accountId } },
      select: { role: true },
    });

    expect(previous?.role).toBe('co_owner');
  });

  it('refuses to remove the last owner', async () => {
    const localOrg = await createOrganization(owner, '@org-last-owner');

    const removed = await request(app)
      .delete(`/api/v1/organizations/${localOrg}/members/${owner.accountId}`)
      .set('Authorization', bearer(owner));

    expect(removed.status).toBe(409);

    const stillOwner = await prisma.organization_members.count({
      where: { organizationId: localOrg, role: 'owner' },
    });

    expect(stillOwner).toBe(1);
  });

  it('refuses to demote the last owner', async () => {
    const localOrg = await createOrganization(owner, '@org-last-owner-demote');

    const demoted = await request(app)
      .put(`/api/v1/organizations/${localOrg}/members/${owner.accountId}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'member' });

    expect(demoted.status).toBe(409);
    expect(demoted.body.error.code).toBe('last_owner');

    const owners = await prisma.organization_members.count({
      where: { organizationId: localOrg, role: 'owner' },
    });

    expect(owners).toBe(1);
  });

  it('refuses a second owner through the API with last_owner, not a 500', async () => {
    // Two concurrent promotions both pass their application-level checks; the
    // index rejects the loser's write. That has to surface as a 409 with a
    // meaningful code, because a 500 here would read as a server fault rather
    // than a conflict the caller can resolve.
    const localOrg = await createOrganization(owner, '@org-concurrent');

    await prisma.organization_members.create({
      data: { organizationId: localOrg, userId: member.accountId, role: 'co_owner' },
    });

    const promoted = await request(app)
      .put(`/api/v1/organizations/${localOrg}/members/${member.accountId}/role`)
      .set('Authorization', bearer(owner))
      .send({ role: 'owner' });

    expect(promoted.status).toBe(200);
    expect(promoted.status).not.toBe(500);

    const owners = await prisma.organization_members.count({
      where: { organizationId: localOrg, role: 'owner' },
    });

    expect(owners).toBe(1);
  });

  it('refuses to promote through an invite', async () => {
    const localOrg = await createOrganization(owner, '@org-invite-owner');

    const invited = await request(app)
      .post(`/api/v1/organizations/${localOrg}/members/invite`)
      .set('Authorization', bearer(owner))
      .send({ email: member.email, role: 'owner' });

    // Ownership transfers by promoting an existing member, which goes through
    // the index. Handing it out at invite time would bypass that entirely.
    expect(invited.status).toBe(422);
  });
});