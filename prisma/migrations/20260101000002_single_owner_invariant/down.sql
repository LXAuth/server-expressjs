-- Reverses 20260101000001_single_owner_invariant.

DROP INDEX IF EXISTS one_primary_address_per_account;
DROP INDEX IF EXISTS one_primary_wallet_per_account;
DROP INDEX IF EXISTS one_primary_email_per_account;

-- Drop the enum checks by name. They were added with IF NOT EXISTS guards, so
-- they may not exist.
ALTER TABLE organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE account_memberships DROP CONSTRAINT IF EXISTS account_memberships_tier_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;

DROP INDEX IF EXISTS one_owner_per_org;
