import { z } from "zod";

/** A value that is missing, empty, or still an `.env.example` placeholder counts as unset. */
function isUnset(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === "" || value.trim().startsWith("your_");
}

const intFromEnv = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: intFromEnv(3000, 1, 65_535),
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TRUST_PROXY: intFromEnv(0, 0, 10),
  SESSION_TTL_HOURS: intFromEnv(720, 1, 24 * 365),
  MAX_SESSIONS_PER_ACCOUNT: intFromEnv(50, 1, 1_000),
  LOGIN_MAX_ATTEMPTS: intFromEnv(5, 1, 100),
  LOGIN_LOCK_MINUTES: intFromEnv(15, 1, 24 * 60),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITLAB_CLIENT_ID: z.string().optional(),
  GITLAB_CLIENT_SECRET: z.string().optional(),
  GITLAB_BASE_URL: z.url().default("https://gitlab.com"),
});

export type ProviderCode = "github" | "gitlab";

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Base URL of the provider's web UI (authorize / token endpoints). */
  baseUrl: string;
}

export interface Config {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  trustProxy: number;
  sessionTtlHours: number;
  maxSessionsPerAccount: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  /** Only providers whose id and secret are both set appear here. */
  providers: Partial<Record<ProviderCode, OAuthProviderConfig>>;
}

function provider(
  id: string | undefined,
  secret: string | undefined,
  baseUrl: string,
): OAuthProviderConfig | undefined {
  if (isUnset(id) || isUnset(secret)) return undefined;
  return { clientId: id.trim(), clientSecret: secret.trim(), baseUrl: baseUrl.replace(/\/+$/, "") };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  const providers: Config["providers"] = {};
  const github = provider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, "https://github.com");
  const gitlab = provider(env.GITLAB_CLIENT_ID, env.GITLAB_CLIENT_SECRET, env.GITLAB_BASE_URL);
  if (github) providers.github = github;
  if (gitlab) providers.gitlab = gitlab;

  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    databaseUrl: env.DATABASE_URL,
    trustProxy: env.TRUST_PROXY,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    maxSessionsPerAccount: env.MAX_SESSIONS_PER_ACCOUNT,
    loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
    loginLockMinutes: env.LOGIN_LOCK_MINUTES,
    providers,
  };
}
