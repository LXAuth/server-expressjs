import { defineConfig } from 'prisma/config';

/**
 * Resolves which schema Prisma uses, from the same PROD flag the application
 * reads. The datasource `provider` in a schema file has to be a literal, so it
 * cannot be selected by an env var — two schema files and one config is the way
 * to serve both providers from a single source of truth.
 *
 * Production runs Postgres with migration history. Development runs a local
 * SQLite file so setup needs no external service; that database is synced with
 * `db push` rather than migrated.
 */
const isProd = process.env.PROD === 'true';

export default defineConfig({
  schema: isProd ? 'prisma/schema.prisma' : 'prisma/schema.dev.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
});
