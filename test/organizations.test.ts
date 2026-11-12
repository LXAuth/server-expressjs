import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import { freshDatabase, testConfig } from "./helpers.js";
import { makeUser, PASSWORD, type Harness, type User } from "./harness.js";

let db: Db;
const h = {} as Harness;

beforeAll(async () => {
  db = await freshDatabase();
  h.app = createApp({
    config: testConfig(),
    db,
    log: () => {},
    rateLimits: { global: 10_000, auth: 10_000, register: 10_000 },
  }).app;
});
afterAll(() => db.end());

async function accountId(user: User): Promise<string> {
  const { rows } = await db.query("SELECT account_id FROM account_emails WHERE email = $1", [user.email]);
  return rows[0].account_id;
}

async function createOrg(owner: User, slug: string): Promise<string> {
  const res = await owner.as(request(h.app).post("/api/v1/organizations")).send({ slug, name: slug.toUpperCase() });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function invite(by: User, orgId: string, body: object = {}) {
  return by.as(request(h.app).post(`/api/v1/organizations/${orgId}/invites`)).send(body);
}

async function join(user: User, by: User, orgId: string, role = "member"): Promise<void> {
  const inv = await invite(by, orgId, { role });
  expect(inv.status).toBe(201);
  const res = await user.as(request(h.app).post("/api/v1/invites/accept")).send({ invite_token: inv.body.invite_token });
  expect(res.status).toBe(200);
}

const access = (user: User, orgId: string, role?: string) =>
  user.as(request(h.app).get(`/api/v1/organizations/${orgId}/access${role ? `?role=${role}` : ""}`));

describe("organizations", () => {
  let owner: User, admin: User, member: User, guest: User, outsider: User;
  let orgId: string;

  beforeAll(async () => {
    owner = await makeUser(h, "owner@example.com");
    admin = await makeUser(h, "admin@example.com");
    member = await makeUser(h, "member@example.com");
    guest = await makeUser(h, "guest@example.com");
    outsider = await makeUser(h, "outsider@example.com");
    orgId = await createOrg(owner, "acme");
    await join(admin, owner, orgId, "admin");
    await join(member, admin, orgId, "member");
    await join(guest, admin, orgId, "guest");
  });

  it("creates with a unique, normalised slug and lists your own organizations", async () => {
    const dup = await outsider.as(request(h.app).post("/api/v1/organizations")).send({ slug: "ACME", name: "x" });
    expect(dup.status).toBe(409);
    const mine = await member.as(request(h.app).get("/api/v1/organizations"));
    expect(mine.body.organizations).toMatchObject([{ id: orgId, slug: "acme", role: "member" }]);
  });

  it("answers access checks with a status and a message only", async () => {
    const ok = await access(admin, orgId, "admin");
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ message: "Access granted" });

    expect((await access(member, orgId, "admin")).status).toBe(403);
    expect((await access(guest, orgId)).status).toBe(200);
    expect((await access(guest, orgId, "member")).status).toBe(403);

    const stranger = await access(outsider, orgId);
    const missing = await access(owner, "00000000-0000-4000-8000-000000000000");
    expect(stranger.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(stranger.body).toEqual(missing.body);

    expect((await access(owner, orgId, "superuser")).status).toBe(400);
  });

  it("hides the organization from non-members", async () => {
    expect((await outsider.as(request(h.app).get(`/api/v1/organizations/${orgId}`))).status).toBe(404);
    expect((await outsider.as(request(h.app).get(`/api/v1/organizations/${orgId}/members`))).status).toBe(404);
  });

  it("lists members by profile, not email, and keeps guests out of the list", async () => {
    await owner.as(request(h.app).patch("/api/v1/account/profile")).send({ name_id: "the-owner" }).expect(200);
    const res = await member.as(request(h.app).get(`/api/v1/organizations/${orgId}/members`));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { role: string }) => m.role)).toEqual(["owner", "admin", "member", "guest"]);
    expect(res.body.members[0].name_id).toBe("the-owner");
    expect(JSON.stringify(res.body)).not.toContain("@example.com");
    expect((await guest.as(request(h.app).get(`/api/v1/organizations/${orgId}/members`))).status).toBe(403);
  });

  it("only lets stronger roles change weaker ones", async () => {
    const memberId = await accountId(member);
    const adminId = await accountId(admin);
    const ownerId = await accountId(owner);
    const patch = (by: User, target: string, role: string) =>
      by.as(request(h.app).patch(`/api/v1/organizations/${orgId}/members/${target}`)).send({ role });

    expect((await patch(member, adminId, "guest")).status).toBe(403);
    expect((await patch(admin, memberId, "admin")).status).toBe(403); // cannot create a peer
    expect((await patch(admin, adminId, "co_owner")).status).toBe(403); // cannot promote self
    expect((await patch(admin, ownerId, "member")).status).toBe(400);
    expect((await patch(owner, memberId, "owner")).status).toBe(400);
    expect((await patch(admin, memberId, "guest")).status).toBe(200);
    expect((await patch(owner, memberId, "co_owner")).status).toBe(200);
    expect((await patch(admin, memberId, "member")).status).toBe(403); // now outranks admin
    expect((await patch(owner, memberId, "member")).status).toBe(200);
  });

  it("restricts invites by rank, email, expiry, and single use", async () => {
    expect((await invite(member, orgId, { role: "guest" })).status).toBe(403);
    expect((await invite(admin, orgId, { role: "admin" })).status).toBe(403);
    expect((await invite(owner, orgId, { role: "owner" })).status).toBe(400);

    const targeted = await invite(admin, orgId, { role: "member", email: "Invitee@Example.com" });
    expect(targeted.status).toBe(201);
    expect(targeted.body.invite_token).toMatch(/^lxi_/);
    const wrong = await outsider.as(request(h.app).post("/api/v1/invites/accept")).send({
      invite_token: targeted.body.invite_token,
    });
    expect(wrong.status).toBe(400);

    const invitee = await makeUser(h, "invitee@example.com");
    const ok = await invitee.as(request(h.app).post("/api/v1/invites/accept")).send({
      invite_token: targeted.body.invite_token,
    });
    expect(ok.status).toBe(200);
    const reuse = await invitee.as(request(h.app).post("/api/v1/invites/accept")).send({
      invite_token: targeted.body.invite_token,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toEqual(wrong.body);

    const open = await invite(admin, orgId, {});
    const pending = await admin.as(request(h.app).get(`/api/v1/organizations/${orgId}/invites`));
    expect(pending.body.invites.map((i: { id: string }) => i.id)).toContain(open.body.id);
    expect(JSON.stringify(pending.body)).not.toContain("lxi_");
    await admin.as(request(h.app).delete(`/api/v1/organizations/${orgId}/invites/${open.body.id}`)).expect(200);
    const revoked = await outsider.as(request(h.app).post("/api/v1/invites/accept")).send({
      invite_token: open.body.invite_token,
    });
    expect(revoked.status).toBe(400);
  });

  it("removes members by rank and lets anyone but the owner leave", async () => {
    const guestId = await accountId(guest);
    const adminId = await accountId(admin);
    const ownerId = await accountId(owner);
    expect((await member.as(request(h.app).delete(`/api/v1/organizations/${orgId}/members/${guestId}`))).status).toBe(403);
    expect((await owner.as(request(h.app).delete(`/api/v1/organizations/${orgId}/members/${ownerId}`))).status).toBe(400);
    expect((await admin.as(request(h.app).delete(`/api/v1/organizations/${orgId}/members/${guestId}`))).status).toBe(200);
    expect((await access(guest, orgId)).status).toBe(403);
    expect((await admin.as(request(h.app).delete(`/api/v1/organizations/${orgId}/members/${adminId}`))).status).toBe(200);
    expect((await access(admin, orgId)).status).toBe(403);
  });

  it("transfers ownership and keeps exactly one owner", async () => {
    const memberId = await accountId(member);
    const ownerId = await accountId(owner);
    expect(
      (await member.as(request(h.app).post(`/api/v1/organizations/${orgId}/transfer`)).send({ account_id: ownerId })).status,
    ).toBe(403);
    const res = await owner.as(request(h.app).post(`/api/v1/organizations/${orgId}/transfer`)).send({ account_id: memberId });
    expect(res.status).toBe(200);
    expect((await access(member, orgId, "owner")).status).toBe(200);
    expect((await access(owner, orgId, "owner")).status).toBe(403);
    expect((await access(owner, orgId, "co_owner")).status).toBe(200);

    await expect(
      db.query("UPDATE organization_members SET role = 'owner' WHERE organization_id = $1 AND account_id = $2", [
        orgId,
        ownerId,
      ]),
    ).rejects.toThrow(/organization_members_one_owner/);
  });

  it("blocks deleting an account that owns an organization, then deletes the organization", async () => {
    const del = await member.as(request(h.app).delete("/api/v1/account")).send({ password: PASSWORD });
    expect(del.status).toBe(409);
    expect((await owner.as(request(h.app).delete(`/api/v1/organizations/${orgId}`))).status).toBe(403);
    expect((await member.as(request(h.app).delete(`/api/v1/organizations/${orgId}`))).status).toBe(200);
    expect((await access(member, orgId)).status).toBe(403);
    expect((await member.as(request(h.app).delete("/api/v1/account")).send({ password: PASSWORD })).status).toBe(200);
  });
});
