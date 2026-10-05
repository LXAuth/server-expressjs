import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Per-file test database setup.
 *
 * Runs `db push` against a throwaway SQLite file and then applies
 * `prisma/dev-invariant.sql`, so each file gets the partial unique indexes the
 * real database carries. That second step matters: two of the tests below assert
 * that the database refuses a second owner and a second primary wallet, and
 * without the indexes those tests would pass for the wrong reason — the
 * application code would be the only thing holding the line, which is exactly
 * what task 6 said must not be relied on.
 *
 * **Set `TEST_DATABASE_URL` to run against Postgres instead.** That is the run
 * that matters before release, and it is the only one that exercises the CHECK
 * constraints from `20260101000002_single_owner_invariant` — `db push` does not
 * apply migrations, so a dev database never has them.
 */

const usePostgres = process.env.TEST_DATABASE_URL !== undefined && process.env.TEST_DATABASE_URL !== '';

let sqliteDir: string | undefined;
let sqlitePath: string | undefined;

beforeAll(async () => {
  if (usePostgres) {
    // Assumed already migrated — `prisma migrate deploy`. The suite does not
    // wipe it, so point this at a database you are willing to have emptied.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }

  sqliteDir = mkdtempSync(join(tmpdir(), 'lxauth-test-'));
  sqlitePath = join(sqliteDir, 'test.db');
  process.env.DATABASE_URL = `file:${sqlitePath}`;

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });

  // sqlite3 is not a Node dependency and not every machine has the CLI. The
  // indexes are applied through Prisma's own raw escape hatch instead, so the
  // suite needs nothing beyond `npm install`.
  const { PrismaClient } = await import('@prisma/client');
  const { readFileSync } = await import('node:fs');

  const sql = readFileSync(join(process.cwd(), 'prisma', 'dev-invariant.sql'), 'utf8');
  const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  for (const statement of sql.split(';')) {
    const trimmed = statement
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim();
    if (trimmed.length > 0) {
      await client.$executeRawUnsafe(trimmed);
    }
  }

  await client.$disconnect();
});

afterAll(async () => {
  if (!sqliteDir) return;

  // The app's own client is a module singleton and may still hold the file open.
  const { disconnectPrisma } = await import('../src/lib/prisma.js');
  await disconnectPrisma();

  rmSync(sqliteDir, { recursive: true, force: true });
});