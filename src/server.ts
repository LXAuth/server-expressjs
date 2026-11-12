import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = createApp({ config });

const server = app.listen(config.port, config.host, () => {
  const providers = Object.keys(config.providers);
  console.log(`LXAuth listening on ${config.host}:${config.port}`);
  console.log(`Linked-account providers: ${providers.length > 0 ? providers.join(", ") : "none (email only)"}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
