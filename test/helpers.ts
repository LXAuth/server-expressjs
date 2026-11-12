import { loadConfig, type Config } from "../src/config.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://lxauth:lxauth@localhost:5432/lxauth_test";

export function testConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({ NODE_ENV: "test", DATABASE_URL: TEST_DATABASE_URL, ...overrides });
}
