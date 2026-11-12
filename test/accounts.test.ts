import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import { freshDatabase, testConfig } from "./helpers.js";

let db: Db;
let app: ReturnType<typeof createApp>["app"];

const PASSWORD = "correct horse battery";

beforeAll(async () => {
  db = await freshDatabase();
  ({ app } = createApp({
    config: testConfig({ LOGIN_MAX_ATTEMPTS: "3", MAX_SESSIONS_PER_ACCOUNT: "3" }),
    db,
    log: () => {},
    rateLimits: { global: 10_000, auth: 10_000, register: 10_000 },
  }));
});

afterAll(async () => {
  await db.end();
});

const basic = (email: string, password: string) =>
  `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`;

async function register(email: string, password = PASSWORD) {
  return request(app).post("/api/v1/accounts").send({ email, password });
}

interface Client {
  client_id: string;
  client_secret: string;
}

async function newClient(ownerEmail: string, name = "Test app"): Promise<Client> {
  const res = await request(app)
    .post("/api/v1/clients")
    .set("Authorization", basic(ownerEmail, PASSWORD))
    .send({ name, redirect_uri: "https://app.example.com/linked" });
  expect(res.status).toBe(201);
  return res.body as Client;
}

function asClient(client: Client, req: request.Test): request.Test {
  return req.set("X-Client-Id", client.client_id).set("X-Client-Secret", client.client_secret);
}

async function login(client: Client, email: string, password = PASSWORD) {
  return asClient(client, request(app).post("/api/v1/auth/login")).send({ email, password });
}

async function loginToken(client: Client, email: string, password = PASSWORD): Promise<string> {
  const res = await login(client, email, password);
  expect(res.status).toBe(200);
  return res.body.session_token as string;
}

function withSession(client: Client, token: string, req: request.Test): request.Test {
  return asClient(client, req).set("Authorization", `Bearer ${token}`);
}

describe("registration", () => {
  it("creates an account and returns only a message", async () => {
    const res = await register("Dev@Example.com");
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Account created" });
  });

  it("rejects a duplicate address regardless of case", async () => {
    const res = await register("dev@example.COM");
    expect(res.status).toBe(409);
  });

  it("enforces the password policy and rejects unknown fields", async () => {
    expect((await register("short@example.com", "short")).status).toBe(400);
    const extra = await request(app)
      .post("/api/v1/accounts")
      .send({ email: "x@example.com", password: PASSWORD, admin: true });
    expect(extra.status).toBe(400);
  });

  it("requires a JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/accounts")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("email=a@example.com&password=xxxxxxxxxxxx");
    expect(res.status).toBe(415);
  });
});

describe("clients", () => {
  it("needs the owner's credentials", async () => {
    const res = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", basic("dev@example.com", "wrong password!"))
      .send({ name: "x" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Basic/);
  });

  it("creates, lists, updates, and rotates a client", async () => {
    const client = await newClient("dev@example.com", "Listing app");
    expect(client.client_id).toMatch(/^lxc_/);
    expect(client.client_secret).toMatch(/^lxs_/);

    const auth = basic("dev@example.com", PASSWORD);
    const list = await request(app).get("/api/v1/clients").set("Authorization", auth);
    expect(list.status).toBe(200);
    const listed = list.body.clients.find((c: { client_id: string }) => c.client_id === client.client_id);
    expect(listed).toMatchObject({ name: "Listing app" });
    expect(JSON.stringify(list.body)).not.toContain("secret");

    const patch = await request(app)
      .patch(`/api/v1/clients/${client.client_id}`)
      .set("Authorization", auth)
      .send({ name: "Renamed" });
    expect(patch.status).toBe(200);

    const rotated = await request(app).post(`/api/v1/clients/${client.client_id}/secret`).set("Authorization", auth);
    expect(rotated.status).toBe(200);
    // The old secret stops working at once.
    expect((await login(client, "dev@example.com")).status).toBe(401);
    expect((await login({ ...client, client_secret: rotated.body.client_secret }, "dev@example.com")).status).toBe(200);
  });

  it("hides clients owned by someone else", async () => {
    await register("other@example.com");
    const theirs = await newClient("other@example.com");
    const res = await request(app)
      .delete(`/api/v1/clients/${theirs.client_id}`)
      .set("Authorization", basic("dev@example.com", PASSWORD));
    expect(res.status).toBe(404);
  });
});

describe("login", () => {
  let client: Client;
  beforeAll(async () => {
    await register("user@example.com");
    client = await newClient("dev@example.com");
  });

  it("returns 200 with a message and an opaque token, and no account data", async () => {
    const res = await login(client, "user@example.com");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["message", "session_token"]);
    expect(res.body.message).toBe("Login successful");
    expect(res.body.session_token).toMatch(/^lxa_[A-Za-z0-9_-]{43}$/);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const unknown = await login(client, "nobody@example.com");
    const wrong = await login(client, "user@example.com", "not the password");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({ message: "Invalid credentials" });
  });

  it("refuses calls without valid client credentials", async () => {
    const none = await request(app).post("/api/v1/auth/login").send({ email: "user@example.com", password: PASSWORD });
    expect(none.status).toBe(401);
    const bad = await login({ ...client, client_secret: "lxs_wrong" }, "user@example.com");
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ message: "Invalid client credentials" });
  });

  it("locks the account after repeated failures, without saying so", async () => {
    await register("locked@example.com");
    for (let i = 0; i < 3; i++) {
      expect((await login(client, "locked@example.com", "wrong password!")).status).toBe(401);
    }
    const res = await login(client, "locked@example.com");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Invalid credentials" });
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE event = 'login.locked'",
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("multiple sessions", () => {
  let appA: Client;
  let appB: Client;
  beforeAll(async () => {
    await register("multi@example.com");
    appA = await newClient("dev@example.com", "App A");
    appB = await newClient("dev@example.com", "App B");
  });

  it("keeps several sessions alive at once, across clients", async () => {
    const a1 = await loginToken(appA, "multi@example.com");
    const a2 = await loginToken(appA, "multi@example.com");
    const b1 = await loginToken(appB, "multi@example.com");

    for (const [client, token] of [
      [appA, a1],
      [appA, a2],
      [appB, b1],
    ] as const) {
      const res = await withSession(client, token, request(app).get("/api/v1/auth/session"));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "Session is valid" });
    }

    const list = await withSession(appA, a1, request(app).get("/api/v1/sessions"));
    expect(list.body.sessions).toHaveLength(3);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.sessions.map((s: { client_name: string }) => s.client_name).sort()).toEqual([
      "App A",
      "App A",
      "App B",
    ]);
  });

  it("rejects a token presented by a different client", async () => {
    const token = await loginToken(appA, "multi@example.com");
    const res = await withSession(appB, token, request(app).get("/api/v1/auth/session"));
    expect(res.status).toBe(401);
  });

  it("caps active sessions by revoking the least recently used", async () => {
    await register("cap@example.com");
    const tokens = [];
    for (let i = 0; i < 4; i++) tokens.push(await loginToken(appA, "cap@example.com"));
    const first = await withSession(appA, tokens[0]!, request(app).get("/api/v1/auth/session"));
    expect(first.status).toBe(401);
    const last = await withSession(appA, tokens[3]!, request(app).get("/api/v1/sessions"));
    expect(last.body.sessions).toHaveLength(3);
  });

  it("logs out one session, then signs out all the others", async () => {
    await register("logout@example.com");
    const t1 = await loginToken(appA, "logout@example.com");
    const t2 = await loginToken(appA, "logout@example.com");
    const t3 = await loginToken(appB, "logout@example.com");

    expect((await withSession(appA, t1, request(app).post("/api/v1/auth/logout"))).status).toBe(200);
    expect((await withSession(appA, t1, request(app).get("/api/v1/auth/session"))).status).toBe(401);

    const others = await withSession(appA, t2, request(app).delete("/api/v1/sessions"));
    expect(others.body).toEqual({ message: "Signed out 1 other session(s)" });
    expect((await withSession(appB, t3, request(app).get("/api/v1/auth/session"))).status).toBe(401);
    expect((await withSession(appA, t2, request(app).get("/api/v1/auth/session"))).status).toBe(200);
  });

  it("revokes a specific session and refuses someone else's", async () => {
    await register("revoke@example.com");
    const mine = await loginToken(appA, "revoke@example.com");
    const victim = await loginToken(appB, "revoke@example.com");
    const list = await withSession(appA, mine, request(app).get("/api/v1/sessions"));
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);

    const stranger = await loginToken(appA, "multi@example.com");
    const denied = await withSession(appA, stranger, request(app).delete(`/api/v1/sessions/${other.id}`));
    expect(denied.status).toBe(404);

    const ok = await withSession(appA, mine, request(app).delete(`/api/v1/sessions/${other.id}`));
    expect(ok.status).toBe(200);
    expect((await withSession(appB, victim, request(app).get("/api/v1/auth/session"))).status).toBe(401);
  });

  it("ends every session of a client when the client is revoked", async () => {
    const temp = await newClient("dev@example.com", "Temporary");
    const token = await loginToken(temp, "multi@example.com");
    const res = await request(app)
      .delete(`/api/v1/clients/${temp.client_id}`)
      .set("Authorization", basic("dev@example.com", PASSWORD));
    expect(res.status).toBe(200);
    expect((await withSession(temp, token, request(app).get("/api/v1/auth/session"))).status).toBe(401);
  });
});

describe("account emails and password", () => {
  let client: Client;
  let token: string;
  beforeAll(async () => {
    await register("owner@example.com");
    client = await newClient("dev@example.com");
    token = await loginToken(client, "owner@example.com");
  });

  const emails = () => withSession(client, token, request(app).get("/api/v1/account/emails"));

  it("adds addresses with a purpose, and only sign-in addresses can log in", async () => {
    const add = await withSession(client, token, request(app).post("/api/v1/account/emails")).send({
      email: "Receipts@Example.com",
      type: "receipt",
    });
    expect(add.status).toBe(201);

    expect((await login(client, "receipts@example.com")).status).toBe(401);

    const patch = await withSession(client, token, request(app).patch(`/api/v1/account/emails/${add.body.id}`)).send({
      login_enabled: true,
    });
    expect(patch.status).toBe(200);
    expect((await login(client, "receipts@example.com")).status).toBe(200);

    const list = await emails();
    expect(list.body.emails.map((e: { email: string; type: string }) => [e.email, e.type])).toEqual([
      ["owner@example.com", "primary"],
      ["receipts@example.com", "receipt"],
    ]);
  });

  it("refuses an address that belongs to another account", async () => {
    const res = await withSession(client, token, request(app).post("/api/v1/account/emails")).send({
      email: "user@example.com",
      type: "other",
    });
    expect(res.status).toBe(409);
  });

  it("promotes an address to primary and protects the primary", async () => {
    const list = await emails();
    const receipt = list.body.emails.find((e: { type: string }) => e.type === "receipt");
    const primary = list.body.emails.find((e: { type: string }) => e.type === "primary");

    const promote = await withSession(client, token, request(app).patch(`/api/v1/account/emails/${receipt.id}`)).send({
      type: "primary",
    });
    expect(promote.status).toBe(200);

    const after = await emails();
    const types = Object.fromEntries(after.body.emails.map((e: { email: string; type: string }) => [e.email, e.type]));
    expect(types).toEqual({ "receipts@example.com": "primary", "owner@example.com": "other" });

    const removePrimary = await withSession(client, token, request(app).delete(`/api/v1/account/emails/${receipt.id}`));
    expect(removePrimary.status).toBe(400);
    const removeOld = await withSession(client, token, request(app).delete(`/api/v1/account/emails/${primary.id}`));
    expect(removeOld.status).toBe(200);
  });

  it("returns 404 for a malformed id", async () => {
    const res = await withSession(client, token, request(app).delete("/api/v1/account/emails/not-a-uuid"));
    expect(res.status).toBe(404);
  });

  it("changes the password and signs out the other sessions", async () => {
    const other = await loginToken(client, "receipts@example.com");
    const wrong = await withSession(client, token, request(app).put("/api/v1/account/password")).send({
      current_password: "not the password",
      new_password: "a brand new password",
    });
    expect(wrong.status).toBe(403);

    const res = await withSession(client, token, request(app).put("/api/v1/account/password")).send({
      current_password: PASSWORD,
      new_password: "a brand new password",
    });
    expect(res.status).toBe(200);
    expect((await withSession(client, other, request(app).get("/api/v1/auth/session"))).status).toBe(401);
    expect((await withSession(client, token, request(app).get("/api/v1/auth/session"))).status).toBe(200);
    expect((await login(client, "receipts@example.com", "a brand new password")).status).toBe(200);
  });

  it("deletes the account with its password", async () => {
    const res = await withSession(client, token, request(app).delete("/api/v1/account")).send({
      password: "a brand new password",
    });
    expect(res.status).toBe(200);
    expect((await withSession(client, token, request(app).get("/api/v1/auth/session"))).status).toBe(401);
    expect((await login(client, "receipts@example.com", "a brand new password")).status).toBe(401);
  });
});

describe("stored secrets", () => {
  it("never stores a password, token, or client secret in plain form", async () => {
    const { rows: props } = await db.query("SELECT pwd_encrypted FROM account_property");
    for (const p of props) expect(p.pwd_encrypted).toMatch(/^\$argon2id\$/);
    const { rows: sessions } = await db.query("SELECT token_hash FROM sessions");
    for (const s of sessions) expect(s.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const { rows: clients } = await db.query("SELECT secret_hash FROM clients");
    for (const c of clients) expect(c.secret_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
