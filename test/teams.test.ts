import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import { freshDatabase, testConfig } from "./helpers.js";
import { makeUser, type Harness, type User } from "./harness.js";

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

const idOf = async (u: User) =>
  (await db.query("SELECT account_id FROM account_emails WHERE email = $1", [u.email])).rows[0].account_id as string;

async function join(user: User, admin: User, orgId: string, role: string) {
  const inv = await admin.as(request(h.app).post(`/api/v1/organizations/${orgId}/invites`)).send({ role });
  await user.as(request(h.app).post("/api/v1/invites/accept")).send({ invite_token: inv.body.invite_token }).expect(200);
}

describe("teams", () => {
  let owner: User, admin: User, lead: User, dev: User, guest: User, outsider: User;
  let orgId: string, teamId: string;
  const put = (by: User, who: string, role = "member") =>
    by.as(request(h.app).put(`/api/v1/teams/${teamId}/members/${who}`)).send({ role });
  const access = (u: User, role?: string) =>
    u.as(request(h.app).get(`/api/v1/teams/${teamId}/access${role ? `?role=${role}` : ""}`));

  beforeAll(async () => {
    const users: User[] = [];
    for (const n of ["t-owner", "t-admin", "t-lead", "t-dev", "t-guest", "t-out"]) users.push(await makeUser(h, `${n}@example.com`));
    [owner, admin, lead, dev, guest, outsider] = users as [User, User, User, User, User, User];
    orgId = (await owner.as(request(h.app).post("/api/v1/organizations")).send({ slug: "teamco", name: "TeamCo" })).body.id;
    await join(admin, owner, orgId, "admin");
    await join(lead, owner, orgId, "member");
    await join(dev, owner, orgId, "member");
    await join(guest, owner, orgId, "guest");
  });

  it("lets admins create teams with names unique per organization", async () => {
    expect((await dev.as(request(h.app).post(`/api/v1/organizations/${orgId}/teams`)).send({ name: "Core" })).status).toBe(403);
    const created = await admin.as(request(h.app).post(`/api/v1/organizations/${orgId}/teams`)).send({ name: "Core" });
    expect(created.status).toBe(201);
    teamId = created.body.id;
    const dup = await admin.as(request(h.app).post(`/api/v1/organizations/${orgId}/teams`)).send({ name: "core" });
    expect(dup.status).toBe(409);
  });

  it("adds members by role and only from inside the organization", async () => {
    expect((await put(admin, await idOf(lead), "lead")).status).toBe(201);
    expect((await put(lead, await idOf(dev))).status).toBe(201);
    expect((await put(lead, await idOf(dev), "lead")).status).toBe(403);
    expect((await put(dev, await idOf(guest))).status).toBe(403);
    expect((await put(admin, await idOf(outsider))).status).toBe(400);
    expect((await put(admin, await idOf(dev), "member")).status).toBe(200);
  });

  it("answers team access checks with a status and a message only", async () => {
    expect((await access(dev)).body).toEqual({ message: "Access granted" });
    expect((await access(dev, "lead")).status).toBe(403);
    expect((await access(lead, "lead")).status).toBe(200);
    expect((await access(owner, "lead")).status).toBe(200); // org admins and above pass
    expect((await access(guest)).status).toBe(403);
    expect((await access(outsider)).status).toBe(403);
    const missing = await outsider.as(request(h.app).get("/api/v1/teams/00000000-0000-4000-8000-000000000000/access"));
    expect(missing.status).toBe(403);
    expect((await access(dev, "owner")).status).toBe(400);
  });

  it("shows guests only their own teams and hides teams from outsiders", async () => {
    expect((await guest.as(request(h.app).get(`/api/v1/organizations/${orgId}/teams`))).body.teams).toEqual([]);
    expect((await guest.as(request(h.app).get(`/api/v1/teams/${teamId}`))).status).toBe(404);
    expect((await outsider.as(request(h.app).get(`/api/v1/teams/${teamId}`))).status).toBe(404);
    const devView = await dev.as(request(h.app).get(`/api/v1/organizations/${orgId}/teams`));
    expect(devView.body.teams).toMatchObject([{ id: teamId, name: "Core", role: "member" }]);
    const members = await dev.as(request(h.app).get(`/api/v1/teams/${teamId}/members`));
    expect(members.body.members.map((m: { role: string }) => m.role)).toEqual(["lead", "member"]);
  });

  it("lets leads edit the team, but only admins delete it", async () => {
    expect((await lead.as(request(h.app).patch(`/api/v1/teams/${teamId}`)).send({ description: "Core team" })).status).toBe(200);
    expect((await dev.as(request(h.app).patch(`/api/v1/teams/${teamId}`)).send({ name: "Mine" })).status).toBe(403);
    expect((await lead.as(request(h.app).delete(`/api/v1/teams/${teamId}`))).status).toBe(403);
  });

  it("drops team membership when someone leaves the organization", async () => {
    const devId = await idOf(dev);
    await dev.as(request(h.app).delete(`/api/v1/organizations/${orgId}/members/${devId}`)).expect(200);
    expect((await access(dev)).status).toBe(403);
    const members = await lead.as(request(h.app).get(`/api/v1/teams/${teamId}/members`));
    expect(members.body.members.map((m: { account_id: string }) => m.account_id)).not.toContain(devId);
  });

  it("removes members by rank and deletes the team", async () => {
    const leadId = await idOf(lead);
    const devB = await makeUser(h, "t-dev2@example.com");
    await join(devB, owner, orgId, "member");
    await put(lead, await idOf(devB)).expect(201);
    expect((await devB.as(request(h.app).delete(`/api/v1/teams/${teamId}/members/${leadId}`))).status).toBe(403);
    expect((await lead.as(request(h.app).delete(`/api/v1/teams/${teamId}/members/${await idOf(devB)}`))).status).toBe(200);
    expect((await admin.as(request(h.app).delete(`/api/v1/teams/${teamId}`))).status).toBe(200);
    expect((await access(lead)).status).toBe(403);
  });
});
