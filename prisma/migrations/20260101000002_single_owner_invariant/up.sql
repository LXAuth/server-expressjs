-- The single-owner invariant, plus the CHECK constraints that stand in for the
-- native enum types the schema cannot declare.
--
-- Prisma's schema language cannot express a partial unique index, so this file
-- is the only place "exactly 1 owner per organization" can actually be
-- enforced. It matters because application logic alone is racy: two concurrent
-- role updates both read "no owner exists" and both write. A unique index makes
-- the second write fail at the database regardless of application ordering.
--
-- The application catches the violation and turns it into a 409 — see
-- `src/modules/organizations/members.service.ts`.

-- Exactly one owner per organization. Partial, so co_owner, admin, member, and
-- guest rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS one_owner_per_org
  ON organization_members (organization_id)
  WHERE role = 'owner';

-- --- CHECK constraints standing in for enum types -------------------------
-- These are Postgres-only. SQLite has no CHECK-on-enum equivalent that Prisma
-- would emit here, so in development the values are validated in
-- `src/lib/enums.ts` and the `isValidEnumValue` guard rather than by the
-- database. Production gets the stronger guarantee.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_type_check') THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_type_check
      CHECK (type IN ('user', 'organization', 'agent'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_status_check') THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_status_check
      CHECK (status IN ('active', 'suspended', 'deleted'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_memberships_tier_check') THEN
    ALTER TABLE account_memberships
      ADD CONSTRAINT account_memberships_tier_check
      CHECK (tier IN ('free', 'premium', 'enterprise'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_role_check') THEN
    ALTER TABLE organization_members
      ADD CONSTRAINT organization_members_role_check
      CHECK (role IN ('owner', 'co_owner', 'admin', 'member', 'guest'));
  END IF;
END $$;

-- A primary email is only meaningful once the account has one, and an account
-- has at most one. Both are one-way rules: dropping the primary is always
-- allowed, setting a second is not.
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_email_per_account
  ON account_emails (account_id)
  WHERE is_primary = true AND account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_wallet_per_account
  ON wallets (account_id)
  WHERE is_primary = true AND account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_address_per_account
  ON account_addresses (account_id)
  WHERE is_primary = true AND account_id IS NOT NULL;
