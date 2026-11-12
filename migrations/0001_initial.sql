-- LXAuth initial schema.
-- Every secret the server checks (passwords, client secrets, session tokens,
-- OAuth state) is stored as a one-way hash, never in a recoverable form.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Identity platforms. `email` is the native account type; the others can be
-- linked to an account.
CREATE TABLE platforms (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_system   varchar(32)  NOT NULL UNIQUE,
  code_display  varchar(64)  NOT NULL,
  is_linkable   boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO platforms (code_system, code_display, is_linkable) VALUES
  ('email',  'Email',  false),
  ('github', 'GitHub', true),
  ('gitlab', 'GitLab', true);

-- One row per person. `platform_type` is the platform the account signed up through.
CREATE TABLE accounts (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_type  smallint     NOT NULL REFERENCES platforms (id),
  status         varchar(16)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- Credentials and lockout state, kept apart from the account row.
-- `pwd_encrypted` holds an argon2id hash (PHC string), not reversible ciphertext.
CREATE TABLE account_property (
  account_id          uuid         PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  pwd_encrypted       text         NOT NULL,
  pwd_changed_at      timestamptz  NOT NULL DEFAULT now(),
  failed_login_count  integer      NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- What an email address is for, so a throwaway receipt address never stands in
-- for the account's main address.
CREATE TABLE email_types (
  code          varchar(32)  PRIMARY KEY,
  code_display  varchar(64)  NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO email_types (code, code_display) VALUES
  ('primary',      'Primary'),
  ('recovery',     'Recovery'),
  ('notification', 'Notification'),
  ('receipt',      'Receipt'),
  ('other',        'Other');

CREATE TABLE account_emails (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid          NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  email          varchar(254)  NOT NULL CHECK (email = lower(email)),
  type           varchar(32)   NOT NULL REFERENCES email_types (code),
  login_enabled  boolean       NOT NULL DEFAULT false,
  verified_at    timestamptz,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  -- The primary address is always a sign-in address.
  CHECK (type <> 'primary' OR login_enabled)
);

CREATE UNIQUE INDEX account_emails_email_key ON account_emails (email);
CREATE UNIQUE INDEX account_emails_one_primary ON account_emails (account_id) WHERE type = 'primary';
CREATE INDEX account_emails_account_idx ON account_emails (account_id);

-- Applications that developers register. Each authenticates with its public
-- `public_id` and a secret that is shown once and stored as a SHA-256 hash.
CREATE TABLE clients (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id  uuid           NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  public_id         varchar(64)    NOT NULL UNIQUE,
  secret_hash       char(64)       NOT NULL,
  name              varchar(100)   NOT NULL,
  redirect_uri      varchar(2048),
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);

CREATE INDEX clients_owner_idx ON clients (owner_account_id);

-- One row per successful login. An account can hold many at once, and a
-- session only works from the client that created it.
CREATE TABLE sessions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid          NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  client_id     uuid          NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  token_hash    char(64)      NOT NULL UNIQUE,
  user_agent    varchar(512),
  ip_address    inet,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  last_seen_at  timestamptz   NOT NULL DEFAULT now(),
  expires_at    timestamptz   NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX sessions_active_account_idx ON sessions (account_id) WHERE revoked_at IS NULL;

-- GitHub / GitLab identities linked to an account. Only the provider's stable
-- user id and login are kept; provider access tokens are discarded.
CREATE TABLE account_connections (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid          NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  platform_id       smallint      NOT NULL REFERENCES platforms (id),
  provider_user_id  varchar(64)   NOT NULL,
  provider_login    varchar(255)  NOT NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (platform_id, provider_user_id),
  UNIQUE (account_id, platform_id)
);

-- Short-lived state for the provider linking flow (CSRF state + PKCE verifier).
CREATE TABLE oauth_states (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash     char(64)      NOT NULL UNIQUE,
  session_id     uuid          NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  platform_id    smallint      NOT NULL REFERENCES platforms (id),
  code_verifier  varchar(128)  NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  expires_at     timestamptz   NOT NULL
);

-- Append-only security log. No request bodies, passwords, or tokens.
CREATE TABLE audit_events (
  id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  uuid         REFERENCES accounts (id) ON DELETE SET NULL,
  client_id   uuid         REFERENCES clients (id) ON DELETE SET NULL,
  event       varchar(64)  NOT NULL,
  ip_address  inet,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_account_idx ON audit_events (account_id, created_at);

CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER account_property_updated_at BEFORE UPDATE ON account_property
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER account_emails_updated_at BEFORE UPDATE ON account_emails
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER account_connections_updated_at BEFORE UPDATE ON account_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
