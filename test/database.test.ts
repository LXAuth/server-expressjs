import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import type { Db } from "../src/db/pool.js";
import { freshDatabase } from "./helpers.js";

let db: Db;
beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await db.end();
});

describe("migrations", () => {
  it("is idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it("seeds platforms and email types", async () => {
    const platforms = await db.query("SELECT code_system, code_display FROM platforms ORDER BY id");
    expect(platforms.rows).toEqual([
      { code_system: "email", code_display: "Email" },
      { code_system: "github", code_display: "GitHub" },
      { code_system: "gitlab", code_display: "GitLab" },
    ]);
    const types = await db.query("SELECT code FROM email_types ORDER BY code");
    expect(types.rows.map((r) => r.code)).toEqual(["notification", "other", "primary", "receipt", "recovery"]);
  });

  it("allows one primary email per account and unique addresses", async () => {
    const {
      rows: [account],
    } = await db.query(
      "INSERT INTO accounts (platform_type) SELECT id FROM platforms WHERE code_system = 'email' RETURNING id",
    );
    const insert = (email: string, type: string, login = false) =>
      db.query("INSERT INTO account_emails (account_id, email, type, login_enabled) VALUES ($1, $2, $3, $4)", [
        account.id,
        email,
        type,
        login,
      ]);
    await insert("a@example.com", "primary", true);
    await expect(insert("b@example.com", "primary", true)).rejects.toThrow(/account_emails_one_primary/);
    await expect(insert("a@example.com", "receipt")).rejects.toThrow(/account_emails_email_key/);
    await expect(insert("Upper@example.com", "receipt")).rejects.toThrow(/check/);
    await insert("receipts@example.com", "receipt");
  });
});
