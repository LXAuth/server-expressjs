import type { Express } from "express";
import request from "supertest";

export const PASSWORD = "correct horse battery";

export interface Harness {
  app: Express;
  /** One shared developer client, created on first use. */
  client?: { client_id: string; client_secret: string };
}

export interface User {
  email: string;
  token: string;
  /** Adds client credentials and this user's session to a request. */
  as: (req: request.Test) => request.Test;
}

export const basic = (email: string, password = PASSWORD) =>
  `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`;

export function withClient(h: Harness, req: request.Test): request.Test {
  return req.set("X-Client-Id", h.client!.client_id).set("X-Client-Secret", h.client!.client_secret);
}

async function ensureClient(h: Harness): Promise<void> {
  if (h.client) return;
  await request(h.app).post("/api/v1/accounts").send({ email: "harness-dev@example.com", password: PASSWORD }).expect(201);
  const res = await request(h.app)
    .post("/api/v1/clients")
    .set("Authorization", basic("harness-dev@example.com"))
    .send({ name: "Harness app", redirect_uri: "https://app.example.com/back" })
    .expect(201);
  h.client = res.body;
}

/** Registers an account and logs it in through the shared client. */
export async function makeUser(h: Harness, email: string): Promise<User> {
  await ensureClient(h);
  await request(h.app).post("/api/v1/accounts").send({ email, password: PASSWORD }).expect(201);
  const login = await withClient(h, request(h.app).post("/api/v1/auth/login")).send({ email, password: PASSWORD }).expect(200);
  const token = login.body.session_token as string;
  return { email, token, as: (req) => withClient(h, req).set("Authorization", `Bearer ${token}`) };
}
