import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  app,
  bearer,
  createOrganization,
  createUser,
  resetDatabase,
  type TestUser,
} from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * Organizations, members, and teams.
 *
 * The cross-tenant cases are the ones worth having. Most endpoints here take an
 * organization id in the path and a child id in the path after it, and a bare
 * `findUnique` on the child would happily return something belonging to a
 * different organization. Those are the tests that would catch that regression.
 */

let owner: TestUser;
let outsider: TestUser;
let orgId: number;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser();
  outsider = await createUser();
  orgId = await createOrganization(owner);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('organization CRUD', () => {
  it('creates an organization with the caller as owner', async () => {
    const response = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(owner))
      .send({ nameId: '@crud-org', nameDisplay: 'CRUD Org' });

    expect(response.status).toBe(201);
    expect(response.body.nameId).toBe('@crud-org');
  });

  it('has no description field, because the specified DDL has none', async () => {
    // Task 6 removed it deliberately. Accepting a field and discarding it would
    // be worse than refusing it, and adding the column is a migration — the
    // owner's call, not a quiet default.
    const response = await request(app)
      .put(`/api/v1/organizations/${orgId}`)
      .set('Authorization', bearer(owner))
      .send({ description: 'should not be accepted' });

    expect(response.status).toBe(422);
  });

  it('refuses a non-member reading the organization', async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}`)
      .set('Authorization', bearer(outsider));

    expect(response.status).toBe(403);
  });

  it('soft-deletes rather than removing the row', async () => {
    // Audit rows elsewhere reference account ids, so the row has to survive.
    const target = await createOrganization(owner, '@org-to-delete');

    const removed = await request(app)
      .delete(`/api/v1/organizations/${target}`)
      .set('Authorization', bearer(owner));

    expect(removed.status).toBe(200);

    const stillThere = await prisma.accounts.findUnique({
      where: { id: target },
      select: { status: true },
    });

    // An organization is an account row with type 'organization'.
    expect(stillThere?.status).toBe('deleted');
  });
});

describe('members', () => {
  it('refuses an invite that would grant ownership', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/members/invite`)
      .set('Authorization', bearer(owner))
      .send({ email: outsider.email, role: 'owner' });

    // Ownership transfers by promoting an existing member, which goes through
    // the index. Granting it at invite time would bypass that.
    expect(response.status).toBe(422);
  });

  it('refuses a join without a valid invite token', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/members/join`)
      .set('Authorization', bearer(outsider))
      .send({ token: 'not-a-real-invite' });

    expect(response.status).toBe(401);
  });

  it('refuses a join when the redeeming account does not hold the invited email', async () => {
    const third = await createUser();

    const invited = await request(app)
      .post(`/api/v1/organizations/${orgId}/members/invite`)
      .set('Authorization', bearer(owner))
      .send({ email: outsider.email, role: 'member' });

    // A leaked invite link would otherwise be a transferable membership.
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/members/join`)
      .set('Authorization', bearer(third))
      .send({ token: invited.body.token });

    expect(response.status).toBe(403);
  });

  it('refuses a non-member inviting', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/members/invite`)
      .set('Authorization', bearer(outsider))
      .send({ email: 'someone@example.test', role: 'member' });

    expect(response.status).toBe(403);
  });

  it('refuses a non-member listing members', async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}/members`)
      .set('Authorization', bearer(outsider));

    expect(response.status).toBe(403);
  });
});

describe('teams', () => {
  it('creates a team inside the organization', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@team-one', nameDisplay: 'Team One' });

    expect(response.status).toBe(201);
  });

  it('refuses a non-member creating a team', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/teams`)
      .set('Authorization', bearer(outsider))
      .send({ nameId: '@team-sneaky' });

    expect(response.status).toBe(403);
  });

  it('refuses a team id from another organization — the cross-tenant case', async () => {
    // A team belonging to a different organization, requested through this
    // organization's path. A bare `findUnique` on the team id would return it.
    const otherOrg = await createOrganization(owner, '@org-other');

    const theirs = await request(app)
      .post(`/api/v1/organizations/${otherOrg}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@theirs' });

    expect(theirs.status).toBe(201);
    const theirTeamId = theirs.body.teamId as number;

    const response = await request(app)
      .get(`/api/v1/organizations/${orgId}/teams/${theirTeamId}`)
      .set('Authorization', bearer(owner));

    // The caller owns both organizations, so authorization passes — this is
    // purely the tenant-scoping check.
    expect(response.status).toBe(404);
  });

  it('refuses updating a team through the wrong organization', async () => {
    const otherOrg = await createOrganization(owner, '@org-other-two');

    const theirs = await request(app)
      .post(`/api/v1/organizations/${otherOrg}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@theirs-two' });

    const response = await request(app)
      .put(`/api/v1/organizations/${orgId}/teams/${theirs.body.teamId}`)
      .set('Authorization', bearer(owner))
      .send({ nameDisplay: 'Renamed' });

    expect(response.status).toBe(404);
  });

  it('refuses deleting a team through the wrong organization', async () => {
    const otherOrg = await createOrganization(owner, '@org-other-three');

    const theirs = await request(app)
      .post(`/api/v1/organizations/${otherOrg}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@theirs-three' });

    const response = await request(app)
      .delete(`/api/v1/organizations/${orgId}/teams/${theirs.body.teamId}`)
      .set('Authorization', bearer(owner));

    expect(response.status).toBe(404);
  });

  it('refuses a non-member adding a team member', async () => {
    const team = await request(app)
      .post(`/api/v1/organizations/${orgId}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@team-members' });

    const response = await request(app)
      .post(`/api/v1/organizations/${orgId}/teams/${team.body.teamId}/members`)
      .set('Authorization', bearer(outsider))
      .send({ userId: outsider.accountId });

    expect(response.status).toBe(403);
  });

  it('constrains the team role to member or lead', async () => {
    const team = await request(app)
      .post(`/api/v1/organizations/${orgId}/teams`)
      .set('Authorization', bearer(owner))
      .send({ nameId: '@team-roles' });

    // The column is free-text VARCHAR(50) in the specified DDL, not an enum, so
    // unlike organization roles it has no set in `src/lib/enums.ts`. It is
    // constrained here instead.
    const response = await request(app)
      .put(`/api/v1/organizations/${orgId}/teams/${team.body.teamId}`)
      .set('Authorization', bearer(owner))
      .send({ role: 'supervisor' });

    expect(response.status).toBe(422);
  });
});