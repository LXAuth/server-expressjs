-- The baseline schema, generated from `prisma/schema.prisma` by
-- `prisma migrate dev`. It is checked in so the migration history is
-- reproducible and reviewable.
--
-- The enum value sets are not declared as Postgres enum types here — they are
-- VARCHAR columns with CHECK constraints added by
-- `20260101000001_single_owner_invariant`. The reason is in that file.

-- CreateEnum statements for account_type, account_status, membership_tier, and
-- org_role are deliberately absent; see the note above.

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_properties" (
    "account_id" INTEGER NOT NULL,
    "name_id" VARCHAR(50) NOT NULL,
    "name_display" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_properties_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "account_emails" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "email" VARCHAR(255) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_addresses" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "wallet_address" VARCHAR(255) NOT NULL,
    "chain" VARCHAR(50) NOT NULL DEFAULT 'ethereum',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_memberships" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "time_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "time_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id")
);

-- CreateTable
CREATE TABLE "organization_teams" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_team_members" (
    "team_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_team_members_pkey" PRIMARY KEY ("team_id", "user_id")
);

-- CreateTable
CREATE TABLE "account_credentials" (
    "account_id" INTEGER NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_credentials_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invites" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token_hash" TEXT NOT NULL,
    "invited_by_id" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_email_verifications" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web3_nonces" (
    "nonce" TEXT NOT NULL,
    "account_id" INTEGER,
    "chain" VARCHAR(50) NOT NULL DEFAULT 'ethereum',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web3_nonces_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_properties_name_id_key" ON "account_properties"("name_id");
CREATE UNIQUE INDEX "account_emails_email_key" ON "account_emails"("email");
CREATE INDEX "account_emails_account_id_idx" ON "account_emails"("account_id");
CREATE INDEX "account_addresses_account_id_idx" ON "account_addresses"("account_id");
CREATE UNIQUE INDEX "wallets_wallet_address_key" ON "wallets"("wallet_address");
CREATE INDEX "wallets_account_id_idx" ON "wallets"("account_id");
CREATE INDEX "account_memberships_account_id_idx" ON "account_memberships"("account_id");
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE INDEX "organization_teams_organization_id_idx" ON "organization_teams"("organization_id");
CREATE INDEX "organization_team_members_user_id_idx" ON "organization_team_members"("user_id");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_account_id_idx" ON "refresh_tokens"("account_id");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE UNIQUE INDEX "organization_invites_token_hash_key" ON "organization_invites"("token_hash");
CREATE INDEX "organization_invites_organization_id_idx" ON "organization_invites"("organization_id");
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");
CREATE UNIQUE INDEX "account_email_verifications_token_hash_key" ON "account_email_verifications"("token_hash");
CREATE INDEX "account_email_verifications_email_id_idx" ON "account_email_verifications"("email_id");
CREATE INDEX "web3_nonces_account_id_idx" ON "web3_nonces"("account_id");
CREATE INDEX "web3_nonces_expires_at_idx" ON "web3_nonces"("expires_at");

-- AddForeignKey
ALTER TABLE "account_properties" ADD CONSTRAINT "account_properties_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_emails" ADD CONSTRAINT "account_emails_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_addresses" ADD CONSTRAINT "account_addresses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_memberships" ADD CONSTRAINT "account_memberships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_teams" ADD CONSTRAINT "organization_teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "organization_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_credentials" ADD CONSTRAINT "account_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_email_verifications" ADD CONSTRAINT "account_email_verifications_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "account_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
