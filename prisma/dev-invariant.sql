-- The single-owner invariant, for the SQLite development database.
--
-- SQLite supports partial indexes, so the dev database can carry the same
-- guarantee Postgres gets from `20260101000002_single_owner_invariant`. That
-- matters: without it, a race that the production index would reject would pass
-- in development and only fail once deployed.
--
-- Apply it after `npm run db:push`:
--
--   sqlite3 prisma/dev.db < prisma/dev-invariant.sql
--
-- The CHECK constraints from the Postgres migration are deliberately absent —
-- SQLite can express them, but Prisma's `db push` does not manage them and they
-- would be silently dropped on the next push, which is worse than not having
-- them. Enum values are validated in `src/lib/enums.ts` instead.

CREATE UNIQUE INDEX IF NOT EXISTS one_owner_per_org
  ON organization_members (organization_id)
  WHERE role = 'owner';

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_email_per_account
  ON account_emails (account_id)
  WHERE is_primary = 1 AND account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_wallet_per_account
  ON wallets (account_id)
  WHERE is_primary = 1 AND account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_address_per_account
  ON account_addresses (account_id)
  WHERE is_primary = 1 AND account_id IS NOT NULL;
