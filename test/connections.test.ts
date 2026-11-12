import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import type { Fetch } from "../src/oauth/providers.js";
import { freshDatabase, testConfig } from "./helpers.js";

const PASSWORD = "correct horse battery";
const RATE_LIMITS = { global: 10_000, auth: 10_000, register: 10_000 };

let db: Db;
let emailOnly: ReturnType<typeof createApp>["app"];
let withProviders: ReturnType<typeof createApp>["app"];

/** Pretends to be GitHub and GitLab. Each test sets which user the next exchange returns. */
const calls: string[] = [];
let nextUser = { id: 1001, login: "octo" };
const fakeFetch: Fetch = async (input, init) => {
  const url = String(input);
  calls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.endsWith("/login/oauth/access_token") || url.endsWith("/oauth/token")) {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code") === "bad") return Response.json({ error: "bad_verification_code" }, { status: 400 });
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return Response.json({ access_token: "provider-token" });
  }
  if (url === "https://api.github.com/user") return Response.json(nextUser);
  if (url === "https://gitlab.example.com/api/v4/user") return Response.json({ id: nextUser.id, username: nextUser.login });
  return new Response(null, { status: 204 });
};

beforeAll(async () => {
  db = await freshDatabase();
  emailOnly = createApp({
    config: testConfig({ GITHUB_CLIENT_ID: "your_github_client_id", GITHUB_CLIENT_SECRET: "your_github_client_secret" }),
    db,
    log: () => {},
    rateLimits: RATE_LIMITS,
  }).app;
  withProviders = createApp({
    config: testConfig({
      PUBLIC_BASE_URL: "https://auth.example.com",
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret",
      GITLAB_CLIENT_ID: "gl-id",
      GITLAB_CLIENT_SECRET: "gl-secret",
      GITLAB_BASE_URL: "https://gitlab.example.com/",
    }),
    db,
    log: () => {},
    rateLimits: RATE_LIMITS,
    fetch: fakeFetch,
  }).app;
});

afterAll(async () => {
  await db.end();
});

interface Client {
  client_id: string;
  client_secret: string;
}

async function setup(email: string, redirect: string | null = "https://app.example.com/linked") {
  await request(emailOnly).post("/api/v1/accounts").send({ email, password: PASSWORD }).expect(201);
  const created = await request(emailOnly)
    .post("/api/v1/clients")
    .set("Authorization", `Basic ${Buffer.from(`${email}:${PASSWORD}`).toString("base64")}`)
    .send({ name: "App", redirect_uri: redirect })
    .expect(201);
  const client = created.body as Client;
  const login = await request(emailOnly)
    .post("/api/v1/auth/login")
    .set("X-Client-Id", client.client_id)
    .set("X-Client-Secret", client.client_secret)
    .send({ email, password: PASSWORD })
    .expect(200);
  const token = login.body.session_token as string;
  const as = (req: request.Test) =>
    req
      .set("X-Client-Id", client.client_id)
      .set("X-Client-Secret", client.client_secret)
      .set("Authorization", `Bearer ${token}`);
  return { as };
}

async function start(app: typeof withProviders, as: (r: request.Test) => request.Test, provider: string) {
  const res = await as(request(app).post(`/api/v1/connections/${provider}`));
  return res;
}

describe("email-only server (providers unset)", () => {
  it("still lists providers, all disabled", async () => {
    const { as } = await setup("plain@example.com");
    const res = await as(request(emailOnly).get("/api/v1/connections"));
    expect(res.status).toBe(200);
    expect(res.body.connections).toEqual([
      { provider: "github", display: "GitHub", enabled: false, linked: false, login: null, linked_at: null },
      { provider: "gitlab", display: "GitLab", enabled: false, linked: false, login: null, linked_at: null },
    ]);
  });

  it("refuses to start linking", async () => {
    const { as } = await setup("plain2@example.com");
    const res = await start(emailOnly, as, "github");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Provider is not configured on this server" });
  });

  it("returns the generic 404 for an unknown provider", async () => {
    const { as } = await setup("plain3@example.com");
    const res = await start(emailOnly, as, "bitbucket");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });
});

describe("linking GitHub and GitLab", () => {
  it("links GitHub with state and PKCE, then stores only the identity", async () => {
    const { as } = await setup("linker@example.com");
    const started = await start(withProviders, as, "github");
    expect(started.status).toBe(200);
    const authorize = new URL(started.body.authorize_url);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("gh-id");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://auth.example.com/api/v1/connections/github/callback",
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state")!;

    nextUser = { id: 1001, login: "octo" };
    calls.length = 0;
    const cb = await request(withProviders).get(`/api/v1/connections/github/callback?code=abc&state=${state}`);
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toBe("https://app.example.com/linked?provider=github&status=linked");
    // The provider token is revoked right after use.
    expect(calls).toContain("DELETE https://api.github.com/applications/gh-id/token");

    const list = await as(request(withProviders).get("/api/v1/connections"));
    expect(list.body.connections[0]).toMatchObject({ provider: "github", enabled: true, linked: true, login: "octo" });

    // State is single use.
    const replay = await request(withProviders).get(`/api/v1/connections/github/callback?code=abc&state=${state}`);
    expect(replay.status).toBe(400);

    const again = await start(withProviders, as, "github");
    expect(again.status).toBe(409);
  });

  it("refuses to link one GitHub identity to two accounts", async () => {
    const { as } = await setup("second@example.com");
    const started = await start(withProviders, as, "github");
    const state = new URL(started.body.authorize_url).searchParams.get("state")!;
    nextUser = { id: 1001, login: "octo" };
    const cb = await request(withProviders).get(`/api/v1/connections/github/callback?code=abc&state=${state}`);
    expect(cb.headers.location).toBe(
      "https://app.example.com/linked?provider=github&status=error&reason=already_linked",
    );
  });

  it("links a self-managed GitLab and unlinks it", async () => {
    const { as } = await setup("gitlabber@example.com");
    const started = await start(withProviders, as, "gitlab");
    const authorize = new URL(started.body.authorize_url);
    expect(authorize.origin + authorize.pathname).toBe("https://gitlab.example.com/oauth/authorize");
    nextUser = { id: 77, login: "tanuki" };
    const cb = await request(withProviders).get(
      `/api/v1/connections/gitlab/callback?code=abc&state=${authorize.searchParams.get("state")}`,
    );
    expect(cb.headers.location).toBe("https://app.example.com/linked?provider=gitlab&status=linked");

    expect((await as(request(withProviders).delete("/api/v1/connections/gitlab"))).status).toBe(200);
    expect((await as(request(withProviders).delete("/api/v1/connections/gitlab"))).status).toBe(404);
  });

  it("reports a denied or failed authorization back to the client", async () => {
    const { as } = await setup("denied@example.com");
    const s1 = new URL((await start(withProviders, as, "github")).body.authorize_url).searchParams.get("state");
    const denied = await request(withProviders).get(
      `/api/v1/connections/github/callback?error=access_denied&error_uri=https%3A%2F%2Fdocs.github.com%2Fx&state=${s1}`,
    );
    expect(denied.headers.location).toBe("https://app.example.com/linked?provider=github&status=denied");

    const s2 = new URL((await start(withProviders, as, "github")).body.authorize_url).searchParams.get("state");
    const failed = await request(withProviders).get(`/api/v1/connections/github/callback?code=bad&state=${s2}`);
    expect(failed.headers.location).toBe(
      "https://app.example.com/linked?provider=github&status=error&reason=token_exchange_failed",
    );
  });

  it("needs a client redirect URI to send the user back to", async () => {
    const { as } = await setup("noredirect@example.com", null);
    const res = await start(withProviders, as, "github");
    expect(res.status).toBe(400);
  });

  it("rejects a forged state", async () => {
    const res = await request(withProviders).get("/api/v1/connections/github/callback?code=abc&state=lxo_forged");
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });
});
