-- Organizations, their members, and invitations.

CREATE TABLE organizations (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        varchar(50)   NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  name        varchar(100)  NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_members (
  organization_id  uuid         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  account_id       uuid         NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role             varchar(16)  NOT NULL DEFAULT 'member'
                     CHECK (role IN ('owner', 'co_owner', 'admin', 'member', 'guest')),
  joined_at        timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id)
);

-- Exactly one owner per organization. Application checks alone would race:
-- two concurrent changes could both see "no owner" and both write one.
CREATE UNIQUE INDEX organization_members_one_owner
  ON organization_members (organization_id) WHERE role = 'owner';
CREATE INDEX organization_members_account_idx ON organization_members (account_id);

-- Single-use invitations. The token is shown once to the inviter and stored
-- only as a SHA-256 hash. `email`, when set, restricts who may accept.
CREATE TABLE organization_invites (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  token_hash       char(64)      NOT NULL UNIQUE,
  role             varchar(16)   NOT NULL
                     CHECK (role IN ('co_owner', 'admin', 'member', 'guest')),
  email            varchar(254)  CHECK (email = lower(email)),
  invited_by       uuid          REFERENCES accounts (id) ON DELETE SET NULL,
  expires_at       timestamptz   NOT NULL,
  accepted_at      timestamptz,
  accepted_by      uuid          REFERENCES accounts (id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX organization_invites_org_idx ON organization_invites (organization_id);
