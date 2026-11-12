import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);

try {
  const ran = await migrate(db, (line) => console.log(line));
  console.log(ran.length === 0 ? "Database is up to date" : `Applied ${ran.length} migration(s)`);
} finally {
  await db.end();
}
