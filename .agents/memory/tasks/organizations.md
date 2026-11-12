---
name: organizations
description: Task record for 0.2.0 — profiles, organizations, teams, and Ethereum wallets ported from the unmerged 2026-10-05 stack
status: in-progress
---

# Task record — 0.2.0: profiles, organizations, teams, wallets

## Goal

Bring the useful parts of the earlier, never-merged `chore/lxauth-v1` stack (dated
2026-10-05) into the 0.1.0 server, so that once everything merges every old branch can
be deleted.

## Objective

- Profiles: a unique handle, display name, and avatar, readable and editable only by the
  account itself.
- Organizations with five roles (`owner`, `co_owner`, `admin`, `member`, `guest`),
  exactly one owner enforced by the database, ownership transfer, and single-use invite
  tokens.
- Teams inside an organization, with `lead` and `member` roles; team members must belong
  to the organization.
- Zero-trust access checks for client apps: `GET …/access?role=…` answers only
  `200 {"message":"Access granted"}` or `403 {"message":"Access denied"}`, and an unknown
  organization or team answers the same `403`.
- Ethereum wallets: link with a signed Sign-In with Ethereum (EIP-4361) message and sign
  in with one, returning the same `{message, session_token}` as email login. Signatures
  are verified with the audited `@noble/curves` and `@noble/hashes` libraries.

## Decisions agreed with the owner

- The old code is **rewritten, not copied**. Its own record says it never compiled or
  ran, and it was built on Prisma with SQLite in development and on JWTs that carry user
  data in their claims, which conflicts with the 0.1.0 zero-trust design.
- **Dropped:** JWT access/refresh tokens and `verify-token`, membership tiers (no payment
  provider), postal addresses, and email verification (no mail service).
- Wallets attach to an existing account; there is no wallet-only registration.
- Wallet sign-in checks the message's domain against a per-client `siwe_domain`.
- New branches stack on `release/0.1.0`, so open pull requests #2–#7 stay untouched.

## Schema changes

| Change | Purpose |
|---|---|
| `account_property` + `name_id`, `name_display`, `avatar_url` | Profile; `name_id` unique and lowercase |
| `organizations` | `id`, `slug` (unique), `name`, timestamps |
| `organization_members` | `organization_id`, `account_id`, `role`, `joined_at`; one owner per organization by partial unique index |
| `organization_invites` | Hashed single-use token, role, optional email restriction, expiry, acceptance |
| `teams` | `organization_id`, `name` (unique per organization), `description` |
| `team_members` | `team_id`, `account_id`, `role` (`lead` / `member`) |
| `platforms` + `ethereum` | New linkable platform |
| `clients` + `siwe_domain` | Domain a client's wallet sign-in messages must name |
| `wallets` | `account_id`, `chain_id`, lowercase `address` (unique) |
| `wallet_nonces` | Hashed single-use SIWE nonce bound to a client and purpose |

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | LXAuth/server-expressjs | `plan/organizations` | `.agents/memory/tasks/` | |
| 2 | Profiles | Handle, display name, avatar | LXAuth/server-expressjs | `feat/profile` | `migrations/0002_*`, `src/services/profile.ts`, routes, docs | |
| 3 | Organizations | Orgs, members, roles, transfer, invites, access check | LXAuth/server-expressjs | `feat/organization` | `migrations/0003_*`, `src/services/organizations.ts`, routes, docs | |
| 4 | Teams | Teams, team members, access check | LXAuth/server-expressjs | `feat/team` | `migrations/0004_*`, `src/services/teams.ts`, routes, docs | |
| 5 | Wallets | SIWE nonce, wallet sign-in, link, unlink | LXAuth/server-expressjs | `feat/wallet` | `migrations/0005_*`, `src/web3/`, routes, docs | |
| 6 | Release | Version, changelog, README, audit | LXAuth/server-expressjs | `release/0.2.0` | `package.json`, `wiki/logs/0/2/0/`, `README.md` | |

## Progress

### Task 1 — plan/organizations

Landed: this record, with the owner-approved scope and the features left out. Next: task 2
adds profiles.

### Task 2 — feat/profile

Landed: `migrations/0002_profile.sql` adds `name_id` (unique, lowercase, 3–50 of
`a-z 0-9 _ -`, checked in the database too), `name_display`, and `avatar_url` (https only)
to `account_property`. `GET` and `PATCH /api/v1/account/profile` read and update them, with
`null` clearing a field. A shared `test/harness.ts` now creates a client and logged-in users
for the 0.2.0 suites. Next: task 3 adds organizations.

### Task 3 — feat/organization

Landed: `migrations/0003_organizations.sql` (`organizations`, `organization_members` with a
partial unique index for one owner, `organization_invites` with hashed single-use tokens and
an optional email restriction). Endpoints under `/api/v1/organizations` for create, list,
read, update, delete, members, role changes, removal and leaving, ownership transfer, and
invites, plus `POST /api/v1/invites/accept`. The zero-trust check
`GET /api/v1/organizations/{id}/access?role=` returns only `200 Access granted` or
`403 Access denied`, the same for a missing organization. Non-members get `404` elsewhere;
members see each other by profile, never by email; guests cannot list members. An account
that owns an organization cannot be deleted until it transfers or deletes it.

Rules chosen: role changes need admin or above and a rank above both the member's current and
new role (the owner may appoint co-owners); invites follow the same ceiling. Next: task 4
adds teams.
