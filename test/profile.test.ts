import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import { freshDatabase, testConfig } from "./helpers.js";
import { makeUser, type Harness } from "./harness.js";

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = await freshDatabase();
  const { app } = createApp({
    config: testConfig(),
    db,
    log: () => {},
    rateLimits: { global: 10_000, auth: 10_000, register: 10_000 },
  });
  h = { app };
});
afterAll(() => db.end());

describe("profile", () => {
  it("starts empty and is never part of the login response", async () => {
    const ada = await makeUser(h, "ada@example.com");
    const res = await ada.as(request(h.app).get("/api/v1/account/profile"));
    expect(res.body).toEqual({ profile: { name_id: null, name_display: null, avatar_url: null } });
  });

  it("updates, normalises the handle, and clears fields with null", async () => {
    const bob = await makeUser(h, "bob@example.com");
    const patch = await bob
      .as(request(h.app).patch("/api/v1/account/profile"))
      .send({ name_id: "Bob_99", name_display: "Bob", avatar_url: "https://img.example.com/b.png" });
    expect(patch.status).toBe(200);
    expect((await bob.as(request(h.app).get("/api/v1/account/profile"))).body.profile).toEqual({
      name_id: "bob_99",
      name_display: "Bob",
      avatar_url: "https://img.example.com/b.png",
    });
    await bob.as(request(h.app).patch("/api/v1/account/profile")).send({ avatar_url: null }).expect(200);
    expect((await bob.as(request(h.app).get("/api/v1/account/profile"))).body.profile.avatar_url).toBeNull();
  });

  it("rejects a taken or malformed handle and a non-https avatar", async () => {
    const carol = await makeUser(h, "carol@example.com");
    const taken = await carol.as(request(h.app).patch("/api/v1/account/profile")).send({ name_id: "bob_99" });
    expect(taken.status).toBe(409);
    for (const name_id of ["ab", "-bad", "bad-", "has space", "x".repeat(51)]) {
      const res = await carol.as(request(h.app).patch("/api/v1/account/profile")).send({ name_id });
      expect(res.status).toBe(400);
    }
    const http = await carol
      .as(request(h.app).patch("/api/v1/account/profile"))
      .send({ avatar_url: "http://img.example.com/c.png" });
    expect(http.status).toBe(400);
  });
});
