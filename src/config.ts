/**
 * Environment loading, validated once at boot.
 *
 * Reading configuration is not the hard part — failing loudly on a missing
 * secret is. A server that starts with an unset signing key and only discovers
 * it on the first login is a server that has already failed.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function required(name: string, prodOnly: boolean): string {
  const value = read(name);
  if (value !== undefined) return value;
  if (!prodOnly) return '';
  throw new Error(
    `${name} is required in production. Copy .env.example to .env and fill it in.`,
  );
}

function readInt(name: string, fallback: number): number {
  const value = read(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be an integer, got "${value}".`);
  }
  return parsed;
}

/**
 * Production is opt-in: only the exact string "true" counts. Unset, empty,
 * "false", "1", and "yes" all mean development. The asymmetry is the point —
 * a missing or malformed variable must never be able to select production.
 */
const prod = process.env.PROD === 'true';

if (prod && read('DATABASE_URL') === undefined) {
  throw new Error('DATABASE_URL is required in production.');
}

if (!prod) {
  // A signing secret that is absent in development still has to be *a* secret,
  // or every token in dev is signed with the empty string and nothing catches
  // it until the code is deployed.
  if (read('JWT_ACCESS_SECRET') === undefined) {
    throw new Error(
      'JWT_ACCESS_SECRET is required in development too. Use the value from .env.example.',
    );
  }
}

export const config = {
  prod,

  env: prod ? 'production' : 'development',

  server: {
    port: readInt('PORT', 3000),
    host: read('HOST') ?? '0.0.0.0',
    /** How long a graceful shutdown waits for in-flight requests before forcing. */
    shutdownTimeoutMs: readInt('SHUTDOWN_TIMEOUT_MS', 10_000),
  },

  database: {
    /**
     * Null in development, where the SQLite file is configured in the dev
     * schema. Never a silent fallback to SQLite in production — that case threw
     * above rather than reaching here.
     */
    url: prod ? required('DATABASE_URL', true) : read('DATABASE_URL'),
  },

  auth: {
    accessSecret: required('JWT_ACCESS_SECRET', true),
    refreshSecret: required('JWT_REFRESH_SECRET', true),
    /** Access token lifetime in seconds. Short, because it is not revocable. */
    accessTtlSeconds: readInt('ACCESS_TOKEN_TTL', 900),
    /** Refresh token lifetime in seconds. 30 days. */
    refreshTtlSeconds: readInt('REFRESH_TOKEN_TTL', 2_592_000),
    issuer: read('JWT_ISSUER') ?? 'lxauth',
    audience: read('JWT_AUDIENCE') ?? 'lxauth-api',
  },

  tokens: {
    /**
     * Mixed into every refresh, invite, and verification token before hashing.
     * Rotating it invalidates every outstanding session and invite at once,
     * which is the intended way to force a mass logout after a compromise.
     */
    pepper: read('TOKEN_PEPPER') ?? 'lxauth-development-pepper',
  },

  argon2: {
    /** OWASP baseline for argon2id: 19 MiB, 2 passes, 1 lane. */
    memoryCost: readInt('ARGON2_MEMORY_COST', 19_456),
    timeCost: readInt('ARGON2_TIME_COST', 2),
    parallelism: readInt('ARGON2_PARALLELISM', 1),
  },

  app: {
    baseUrl: read('APP_BASE_URL') ?? 'http://localhost:3000',
  },

  web3: {
    /**
     * The domain that goes into the signable message. It has to be stable and
     * client-visible, because a signature is only replay-proof if the domain
     * it was signed against matches the one the server rebuilds.
     */
    domain: read('WEB3_DOMAIN') ?? 'lxauth.local',
    /** A login nonce is short-lived: it only has to survive one wallet prompt. */
    nonceTtlSeconds: readInt('WEB3_NONCE_TTL', 300),
  },

  log: {
    level: read('LOG_LEVEL') ?? (prod ? 'info' : 'debug'),
  },
} as const;

export type Config = typeof config;
