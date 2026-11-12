import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);

// Bring the schema up to date before accepting traffic. The migration runner
// takes an advisory lock, so several instances can start at once.
await migrate(db, (line) => console.log(`migration: ${line}`));

const { app } = createApp({ config, db });

const server = app.listen(config.port, config.host, () => {
  const providers = Object.keys(config.providers);
  console.log(`LXAuth listening on ${config.host}:${config.port}`);
  console.log(`Linked-account providers: ${providers.length > 0 ? providers.join(", ") : "none (email only)"}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void db.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
