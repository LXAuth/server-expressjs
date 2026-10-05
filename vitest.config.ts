import { defineConfig } from 'vitest/config';

/**
 * Test configuration.
 *
 * The suite runs against a real database, not a mock. The properties worth
 * testing here — the single-owner index, the single-use nonce, the CHECK
 * constraints standing in for Postgres enum types — live in the database, and a
 * mocked Prisma would happily agree with whatever the code asserted.
 *
 * By default that database is a throwaway SQLite file, so `npm test` needs no
 * external service. Point `TEST_DATABASE_URL` at Postgres to run the same suite
 * against the production provider — which is the run that matters before
 * release, because `db push` does not apply migrations and dev has no migration
 * history to catch a broken one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Each file gets its own database. Running them in one process against a
    // shared file makes a leaked row in one file surface as a failure in
    // another, which is worse than no isolation.
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});