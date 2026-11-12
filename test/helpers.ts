import { loadConfig, type Config } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://lxauth:lxauth@localhost:5432/lxauth_test";

export function testConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL, ...overrides });
}

/** A migrated, empty test database. Seed rows (platforms, email types) are kept. */
export async function freshDatabase(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL);
  await migrate(db);
  await db.query(
    "TRUNCATE accounts, account_property, account_emails, clients, sessions, account_connections, oauth_states, audit_events CASCADE",
  );
  return db;
}
