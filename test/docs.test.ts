import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { ENDPOINT_GROUPS } from "../src/docs/endpoints.js";
import { TEST_DATABASE_URL, testConfig } from "./helpers.js";

const db = createPool(TEST_DATABASE_URL);
afterAll(() => db.end());

describe("/api page", () => {
  const { app, routes } = createApp({
    config: testConfig({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" }),
    db,
    log: () => {},
  });

  it("serves HTML with a strict, hash-based CSP", async () => {
    const res = await request(app).get("/api");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(res.text).toContain('data-theme="dark"');
    expect(res.text).toContain('id="theme-toggle"');
  });

  it("shows which providers are configured", async () => {
    const res = await request(app).get("/api");
    expect(res.text).toContain("<b>GitHub</b> configured");
    expect(res.text).toContain("<b>GitLab</b> not configured");
  });

  it("documents exactly the declared routes", () => {
    const documented = ENDPOINT_GROUPS.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path}`)).sort();
    const declared = routes.list().map((r) => `${r.method} ${r.path}`).sort();
    expect(documented).toEqual(declared);
  });

  it("is not reachable with a trailing slash or another case", async () => {
    expect((await request(app).get("/api/")).status).toBe(404);
    expect((await request(app).get("/API")).status).toBe(404);
  });
});
