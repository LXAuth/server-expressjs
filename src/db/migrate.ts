import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transaction, type Db } from "./pool.js";

// Resolves to <repo>/migrations from both src/db and dist/db.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));
// Arbitrary constant so two instances starting together do not race.
const LOCK_KEY = 0x4c58_4155;

export async function migrate(db: Db, log: (line: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();

  return transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     varchar(128) PRIMARY KEY,
        applied_at  timestamptz  NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(`${MIGRATIONS_DIR}${file}`, "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      log(`applied ${file}`);
      ran.push(file);
    }
    return ran;
  });
}
