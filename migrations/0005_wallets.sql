-- Ethereum wallets linked to accounts, and the single-use Sign-In with
-- Ethereum (EIP-4361) challenges used to link them or sign in with them.

INSERT INTO platforms (code_system, code_display, is_linkable) VALUES ('ethereum', 'Ethereum', true);

-- The domain a client's sign-in messages name, e.g. "app.example.com".
ALTER TABLE clients ADD COLUMN siwe_domain varchar(253);

CREATE TABLE wallets (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid         NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  address       char(42)     NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id      integer      NOT NULL CHECK (chain_id > 0),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE INDEX wallets_account_idx ON wallets (account_id);

-- The server writes the exact message to be signed and keeps only its hash, so
-- a signature is accepted only for a message this server issued, once.
CREATE TABLE wallet_challenges (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_hash  char(64)     NOT NULL UNIQUE,
  purpose       varchar(8)   NOT NULL CHECK (purpose IN ('login', 'link')),
  client_id     uuid         NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  session_id    uuid         REFERENCES sessions (id) ON DELETE CASCADE,
  address       char(42)     NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id      integer      NOT NULL,
  expires_at    timestamptz  NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CHECK ((purpose = 'link') = (session_id IS NOT NULL))
);

CREATE INDEX wallet_challenges_expires_idx ON wallet_challenges (expires_at);
