---
name: auth-server
description: Task record for building the zero-trust central account server (Express + TypeScript)
status: done
---

# Task record — zero-trust central auth server

## Goal

A central account registry that any number of client applications call to authenticate
their users. One account works across every client the owner or other developers create.

## Objective

- Email accounts with argon2id passwords; several email addresses per account, each with a
  purpose (`primary`, `recovery`, `notification`, `receipt`, `other`).
- Registered clients authenticate every login with a client id and secret.
- A correct login returns `200` with a message and an opaque session token — never user
  data. Every failed login returns the same `401`.
- Many concurrent sessions per account, each listable and revocable.
- Optional GitHub and GitLab account linking; the server runs with email accounts alone when
  their environment variables are unset.
- An `/api` usage page with a dark default theme and a light theme toggle.
- An undeclared-route guard: anything not on the route allowlist gets one generic `404`.
- Latest dependency versions, with `npm audit` clean at release.

## Assumptions agreed with the owner

- "Multiple login" means multiple concurrent sessions or devices per account.
- A session is bound to the client that created it; a token presented by another client is
  rejected.
- GitHub and GitLab are linking only in this release, not sign-in. Provider access tokens
  are never stored — only the provider user id and login.
- `accounts.platform_type` records the platform the account signed up through.
- `account_property.pwd_encrypted` keeps the owner's column name and holds an argon2id hash.

## Schema

| Table | Purpose |
|---|---|
| `platforms` | `id`, `code_system`, `code_display`, `created_at`; seeded with `email`, `github`, `gitlab` |
| `accounts` | `id`, `platform_type` → `platforms`, `status`, `created_at`, `updated_at` |
| `account_property` | `account_id` → `accounts`, `pwd_encrypted`, `pwd_changed_at`, `failed_login_count`, `locked_until`, `created_at`, `updated_at` |
| `email_types` | Lookup of allowed email purposes |
| `account_emails` | `account_id`, `email` (unique, case-insensitive), `type` → `email_types`, `login_enabled`, `verified_at`, `created_at`, `updated_at`; one primary per account |
| `clients` | Developer-registered applications: `client_id`, hashed secret, `redirect_uri`, `revoked_at` |
| `sessions` | One row per login: account, client, hashed token, user agent, IP, expiry, revocation |
| `account_connections` | Linked GitHub / GitLab identities; one provider identity per account |
| `oauth_states` | Short-lived state and PKCE verifier for the linking flow |
| `audit_events` | Append-only log of logins, failures, and revocations |

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record and `.gitignore` | LXAuth/server-expressjs | `plan/auth-server` | `.agents/memory/tasks/`, `.gitignore` | #1 |
| 2 | Scaffold | Express 5 + TypeScript, config, security middleware, route guard | LXAuth/server-expressjs | `build/scaffold` | `package.json`, `tsconfig.json`, `src/`, `.env.example`, `docker-compose.yml` | #2 |
| 3 | Database | Migrations, seeds, migration runner | LXAuth/server-expressjs | `feat/database` | `migrations/`, `src/db/` | #3 |
| 4 | Accounts | Clients, registration, login, sessions, emails, password | LXAuth/server-expressjs | `feat/account` | `src/routes/`, `src/services/`, `test/` | #4 |
| 5 | Provider linking | GitHub and GitLab connections | LXAuth/server-expressjs | `feat/oauth-connection` | `src/oauth/`, `src/routes/connections.ts` | #5 |
| 6 | API page | `/api` usage page, dark and light themes | LXAuth/server-expressjs | `feat/api-docs` | `src/docs/` | #6 |
| 7 | Release | Version, changelog, audit report, README | LXAuth/server-expressjs | `release/0.1.0` | `package.json`, `wiki/logs/0/1/0/`, `README.md` | #7 |

## Progress

### Task 1 — plan/auth-server

Landed: this record with the owner-approved plan, and `.gitignore` (dependencies, build
output, `.env` files, and `.agents/plans/`). Next: task 2 builds the scaffold on top.

### Task 2 — build/scaffold

Landed: Express 5 + TypeScript 7 project (ESM, strict), zod-validated environment config
where `your_*` placeholders count as unset, `.env.example`, `docker-compose.yml` for
PostgreSQL 18, helmet headers, `Cache-Control: no-store`, a global per-IP rate limit, a
10 kB JSON-only body parser, and the `RouteTable` allowlist guard (generic `404` for
undeclared or malformed URLs, `405` with `Allow` for a wrong method). `GET /api/v1/health`
is the only route so far. Next: task 3 adds the database.

### Task 3 — feat/database

Landed: `migrations/0001_initial.sql` with all ten tables from the schema above, seed rows
for `platforms` and `email_types`, `updated_at` triggers, a lowercase-only unique email
index, one primary email per account, and an advisory-locked migration runner
(`npm run migrate`, also run automatically on server start). Naming decision:
`clients.public_id` is the public identifier exposed to callers as `client_id`, so
`sessions.client_id` can be a plain foreign key to `clients.id`. Next: task 4 builds the
account, client, login, and session API on these tables.

### Task 4 — feat/account

Landed: account registration, developer-owned clients (create, list, rename, rotate secret,
revoke — managed with HTTP Basic email and password), login through a client
(`X-Client-Id` / `X-Client-Secret`) returning only `{message, session_token}`, session check,
logout, session listing and revocation, a per-account session cap that evicts the least
recently used session, email management with purposes and a `login_enabled` flag,
password change (signs out other sessions), and account deletion. Failed logins are
indistinguishable (same body, dummy argon2 check for unknown emails) and lock the account
after `LOGIN_MAX_ATTEMPTS`. Every security event is written to `audit_events`.

Decision: registration answers `409` for an address already in use. Hiding that needs email
verification, which needs an outbound mail service that is out of scope for 0.1.0; the
endpoint is rate limited instead. Next: task 5 adds GitHub and GitLab linking.

### Task 5 — feat/oauth-connection

Landed: GitHub and GitLab (including self-managed via `GITLAB_BASE_URL`) account linking.
A client with a session calls `POST /api/v1/connections/{provider}` and receives an
`authorize_url` carrying single-use state and a PKCE S256 challenge; the provider returns the
browser to `/api/v1/connections/{provider}/callback`, which consumes the state, exchanges the
code, reads only the provider user id and login, revokes the provider token, and redirects
with `303` to the client's `redirect_uri` with `provider`, `status`, and `reason`. Listing and
unlinking are under `/api/v1/connections`. With the provider variables unset or left as
`your_*` placeholders, providers report `enabled: false` and linking answers `404`; email
accounts are unaffected. Next: task 6 adds the `/api` page.

### Task 6 — feat/api-docs

Landed: the `/api` usage page — server-rendered once at startup from
`src/docs/endpoints.ts`, dark by default with a light-theme toggle that persists in
`localStorage` and applies before first paint, a section nav, quick-start `curl` steps,
expandable endpoint cards, an errors table, and live provider status. It loads nothing
external and runs under a hash-based CSP with no `unsafe-inline`. A test fails if the
documented endpoints and the declared routes ever drift apart. Checked at 1280 px and
390 px in both themes with no console errors or horizontal scroll. Next: task 7 releases.

### Task 7 — release/0.1.0

Landed: version `0.1.0` in `package.json` and the lockfile, `README.md`,
`wiki/logs/0/1/0/CHANGELOG.md`, the dependency audit in `wiki/logs/0/1/0/NOTES.md`, and
`wiki/logs/logs-index.md`. Every direct dependency is at its latest version and `npm audit`
reports 0 vulnerabilities across 247 packages. `npm audit signatures` could not run because the
build network blocked the registry key download; it is listed as a follow-up. 61 tests pass on
Node.js 22 against PostgreSQL 16.

Left open: email verification (needs an outbound mail service), sign-in with GitHub or GitLab
(linking only for now), a shared rate-limit store for multi-instance deployments, and CI.
Pull requests #1–#7 are open, stacked in task order; the `PR` column above records them.
