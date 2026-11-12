import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { TEST_DATABASE_URL, testConfig } from "./helpers.js";

const db = createPool(TEST_DATABASE_URL);
const { app } = createApp({ config: testConfig(), db, log: () => {} });
afterAll(() => db.end());

describe("undeclared-route guard", () => {
  it("answers a declared route", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "OK" });
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    "/",
    "/api/v1",
    "/api/v1/health/",
    "/API/v1/health",
    "/api/v1/users",
    "/.env",
    "/package.json",
    "/src/config.ts",
    "/api/v1/../../package.json",
    "/api/v1/%2e%2e/health",
    "/api/v1%2fhealth",
    "/api//v1/health",
    "/api/v1/health%00",
    "/api/v1/%252e%252e/health",
  ])("returns the generic 404 for %s", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });

  it("returns 405 with Allow for a known path and wrong method", async () => {
    const res = await request(app).delete("/api/v1/health");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });

  it("rejects OPTIONS so no CORS preflight ever succeeds", async () => {
    const res = await request(app).options("/api/v1/health");
    expect(res.status).toBe(405);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not parse bodies sent to undeclared URLs", async () => {
    const res = await request(app).post("/nope").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(404);
  });
});
