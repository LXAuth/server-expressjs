import request from "supertest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/pool.js";
import { recoverAddress, toChecksumAddress } from "../src/web3/siwe.js";
import { freshDatabase, testConfig } from "./helpers.js";
import { basic, makeUser, withClient, type Harness, type User } from "./harness.js";

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

const wallet = privateKeyToAccount(generatePrivateKey());

async function linkChallenge(user: User, address: string = wallet.address) {
  return user.as(request(h.app).post("/api/v1/account/wallets/challenge")).send({ address, chain_id: 1 });
}
async function loginChallenge(address: string = wallet.address) {
  return withClient(h, request(h.app).post("/api/v1/auth/wallet/challenge")).send({ address, chain_id: 1 });
}
async function walletLogin(message: string, signature: string) {
  return withClient(h, request(h.app).post("/api/v1/auth/wallet/login")).send({ message, signature });
}

describe("signature recovery", () => {
  it("matches viem for EIP-55 checksums and personal_sign recovery", async () => {
    const msg = "line one\nline two";
    const sig = await wallet.signMessage({ message: msg });
    expect(recoverAddress(msg, sig)).toBe(wallet.address.toLowerCase());
    expect(recoverAddress(`${msg}!`, sig)).not.toBe(wallet.address.toLowerCase());
    expect(toChecksumAddress(wallet.address.toLowerCase())).toBe(wallet.address);
    expect(recoverAddress(msg, "0x1234")).toBeNull();
  });
});

describe("wallets", () => {
  let ada: User;

  beforeAll(async () => {
    ada = await makeUser(h, "ada@example.com");
  });

  it("needs the client to declare a sign-in domain", async () => {
    const res = await linkChallenge(ada);
    expect(res.status).toBe(400);
    await request(h.app)
      .patch(`/api/v1/clients/${h.client!.client_id}`)
      .set("Authorization", basic("harness-dev@example.com"))
      .send({ siwe_domain: "App.Example.com" })
      .expect(200);
  });

  it("issues an EIP-4361 message naming the client's domain", async () => {
    const res = await linkChallenge(ada);
    expect(res.status).toBe(200);
    const msg: string = res.body.siwe_message;
    expect(msg.split("\n")[0]).toBe("app.example.com wants you to sign in with your Ethereum account:");
    expect(msg.split("\n")[1]).toBe(wallet.address);
    expect(msg).toMatch(/\nURI: https:\/\/app\.example\.com\nVersion: 1\nChain ID: 1\nNonce: [0-9a-f]{32}\nIssued At: /);
  });

  it("links a wallet only with a valid signature over an issued message", async () => {
    const { body } = await linkChallenge(ada);
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await other.signMessage({ message: body.siwe_message });
    expect((await ada.as(request(h.app).post("/api/v1/account/wallets")).send({ message: body.siwe_message, signature: forged })).status).toBe(400);

    // A challenge is single use, even after a failed attempt.
    const again = await wallet.signMessage({ message: body.siwe_message });
    expect((await ada.as(request(h.app).post("/api/v1/account/wallets")).send({ message: body.siwe_message, signature: again })).status).toBe(400);

    const fresh = await linkChallenge(ada);
    const signature = await wallet.signMessage({ message: fresh.body.siwe_message });
    const tampered = fresh.body.siwe_message.replace("Chain ID: 1", "Chain ID: 5");
    expect((await ada.as(request(h.app).post("/api/v1/account/wallets")).send({ message: tampered, signature })).status).toBe(400);
    const ok = await ada.as(request(h.app).post("/api/v1/account/wallets")).send({ message: fresh.body.siwe_message, signature });
    expect(ok.status).toBe(201);

    const list = await ada.as(request(h.app).get("/api/v1/account/wallets"));
    expect(list.body.wallets).toMatchObject([{ address: wallet.address.toLowerCase(), chain_id: 1 }]);
  });

  it("refuses a link challenge used by another session", async () => {
    const bob = await makeUser(h, "bob@example.com");
    const { body } = await linkChallenge(ada, privateKeyToAccount(generatePrivateKey()).address);
    const res = await bob.as(request(h.app).post("/api/v1/account/wallets")).send({
      message: body.siwe_message,
      signature: await wallet.signMessage({ message: body.siwe_message }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses to link a wallet that belongs to another account", async () => {
    const carol = await makeUser(h, "carol@example.com");
    const { body } = await linkChallenge(carol);
    const res = await carol.as(request(h.app).post("/api/v1/account/wallets")).send({
      message: body.siwe_message,
      signature: await wallet.signMessage({ message: body.siwe_message }),
    });
    expect(res.status).toBe(409);
  });

  it("signs in with a linked wallet and returns only a message and a token", async () => {
    const { body } = await loginChallenge();
    const res = await walletLogin(body.siwe_message, await wallet.signMessage({ message: body.siwe_message }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["message", "session_token"]);
    const check = await withClient(h, request(h.app).get("/api/v1/auth/session")).set(
      "Authorization",
      `Bearer ${res.body.session_token}`,
    );
    expect(check.status).toBe(200);
  });

  it("fails the same way for an unlinked wallet, a bad signature, and a replay", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const c1 = await loginChallenge(stranger.address);
    expect(c1.status).toBe(200);
    const unlinked = await walletLogin(c1.body.siwe_message, await stranger.signMessage({ message: c1.body.siwe_message }));

    const c2 = await loginChallenge();
    const wrongSigner = await walletLogin(c2.body.siwe_message, await stranger.signMessage({ message: c2.body.siwe_message }));

    const c3 = await loginChallenge();
    const sig3 = await wallet.signMessage({ message: c3.body.siwe_message });
    expect((await walletLogin(c3.body.siwe_message, sig3)).status).toBe(200);
    const replay = await walletLogin(c3.body.siwe_message, sig3);

    for (const res of [unlinked, wrongSigner, replay]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Invalid credentials" });
    }
  });

  it("does not accept a login challenge from another client", async () => {
    const { body } = await loginChallenge();
    const sig = await wallet.signMessage({ message: body.siwe_message });
    await request(h.app).post("/api/v1/accounts").send({ email: "dev2@example.com", password: "correct horse battery" });
    const other = await request(h.app)
      .post("/api/v1/clients")
      .set("Authorization", basic("dev2@example.com"))
      .send({ name: "Other", siwe_domain: "app.example.com" });
    const res = await request(h.app)
      .post("/api/v1/auth/wallet/login")
      .set("X-Client-Id", other.body.client_id)
      .set("X-Client-Secret", other.body.client_secret)
      .send({ message: body.siwe_message, signature: sig });
    expect(res.status).toBe(401);
  });

  it("unlinks a wallet, after which it cannot sign in", async () => {
    const list = await ada.as(request(h.app).get("/api/v1/account/wallets"));
    await ada.as(request(h.app).delete(`/api/v1/account/wallets/${list.body.wallets[0].id}`)).expect(200);
    const { body } = await loginChallenge();
    const res = await walletLogin(body.siwe_message, await wallet.signMessage({ message: body.siwe_message }));
    expect(res.status).toBe(401);
  });
});
