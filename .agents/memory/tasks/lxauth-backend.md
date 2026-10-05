# LXAuth backend

Task record. Written before any code existed, so a reviewer can check the plan
against the diff rather than infer the plan from it.

- **Repository:** `LXAuth/server-expressjs`
- **Started:** 2026-10-05
- **Status:** in progress
- **Plan:** `.agents/plans/` — untracked, deleted when the work lands

## Placement deviation

The project lives at `LXAuth/server-expressjs`, not `orgs/LXAuth/server-expressjs`.
The owner's explicit instruction outranks the workspace layout convention in
`AGENTS.md`. Do not move it.

## Scale

11 tables as specified, plus 5 additive, plus 4 enum value sets. 39 endpoints
across 7 groups: auth and session, users, organizations, organization members,
teams, wallets, memberships.

## Tasks

| # | Title | Scope | Branch | PR |
|---|---|---|---|---|
| 1 | Task record | This file, before any code exists | `chore/lxauth-backend-plan` | |
| 2 | Scaffold | TS config, env loading, Express bootstrap, error envelope, structured logger, graceful shutdown | `feat/express-scaffold` | |
| 3 | Prisma schema + migrations | 16 models, 2 schema files, `CHECK` constraints, partial unique index as raw SQL, seed script | `feat/db-schema` | |
| 4 | Auth core | argon2 hashing, JWT access + rotating refresh, login/refresh/logout/verify-token | `feat/auth-core` | |
| 5 | Users + relations | Register, me get/update, password change, org listing, emails, addresses | `feat/users` | |
| 6 | Organizations + members | CRUD, role updates, invite/join, remove — single-owner invariant enforced | `feat/organizations` | |
| 7 | Teams | Team CRUD + team membership | `feat/teams` | |
| 8 | Web3 | Nonce issue/consume, signature login, wallet bind/list/primary/unbind | `feat/web3` | |
| 9 | Memberships | Tier read + upgrade | `feat/memberships` | |
| 10 | Tests | Integration tests over the real schema; explicit cases for `verify-token` and the owner invariant | `test/integration` | |
| 11 | Release | Version, changelog, README, API reference | `chore/lxauth-v1` | |

Tasks stack: each branches from the one before it. Tasks 4–9 all touch route
registration, so they sequence and must not be parallelised.

The `PR` column is filled by task 11, not task 1 — back-filling it early forces a
rebase of the whole stack.

## Decisions

Agreed before the work started. A session that wants to change one records it in
`.agents/memory/decisions/` rather than re-litigating it here.

| Decision | Why |
|---|---|
| `Int`, not `BigInt` | The DDL says `SERIAL`/`INTEGER`. One-way door: once wallets, memberships, and audit rows reference `account_id`, changing it means a migration across every table. Flagged once, defaulted, proceeding. |
| Prisma, not Knex | Named in the handoff. |
| Postgres in prod, SQLite in dev | Owner instruction, 2026-10-05. SQLite keeps local setup to zero external services. |
| Enums as validated `String` columns | Prisma cannot declare `enum` on SQLite, and the datasource `provider` must be a literal — so one schema cannot keep native enums on one side. `CHECK` constraints restore the guarantee in prod; `src/lib/enums.ts` holds the values. |
| `prisma.config.ts` resolves the schema path | Owner chose this over repeating `--schema` across npm scripts. |
| `PROD` defaults to `false` | Owner instruction. Only the literal `"true"` is production, so a missing variable cannot silently point production code at a SQLite file. |
| argon2 password hashing | Named in the handoff. bcrypt is an acceptable swap but was not requested. |
| Refresh tokens rotate on every use | Old token marked revoked. Reuse of a revoked token signals theft, so the whole family dies. |
| Refresh, invite, and email-verification tokens hashed at rest | A stolen database must not yield usable sessions. |
| `verify-token` does no database lookup | Permissions ride in the JWT claims. A Zero Trust core that queries Postgres per call is a per-microservice bottleneck and defeats the point of a central IdP. |
| Single-owner invariant enforced by a partial unique index | Business logic alone is not safe: two concurrent role updates both read "no owner exists" and both write. SQLite supports partial indexes too, so dev gets it as well. |

## Known constraints

* **No network egress in-sandbox.** `npm install`, `prisma generate`,
  `prisma migrate dev`, and `tsc` cannot run in-session. Commands are handed to
  the owner; results come back as a report.
* **Dev has no migration history.** `db push` syncs and stops, so dev cannot catch
  a broken migration. Run task 10's suite against Postgres before release.
* **Task 10 ships unverified** unless the owner runs install and the suite on the
  host. It must not claim a green run nobody observed.
* **Version number for task 11 is unset** and needs the owner's approval.

## Out of scope

* Restructuring the 11 specified tables — they are an input.
* Agent-account endpoints. `agent` is carried as an enum value; no endpoint in the
  spec uses it, and none were invented.
* A payment gateway call. No gateway is named, so `membership/upgrade` writes the
  tier transition behind a provider interface and nothing else.

---

### Task 1 — chore/lxauth-backend-plan

Created this record, the memory index, and `.agents/memory/decisions/`. The
repository was empty apart from `LICENSE` at `71e06c0`, so nothing in this task
constrained the task list — the handoff's list stands as written. Nothing is built
yet; that is the point of writing this first.

### Task 2 — feat/express-scaffold

Package manifest, strict TS config, `prisma.config.ts`, `.env.example`, the config
module, the enum value sets, the JSON logger, the error envelope, the request-id
and error middleware, the Express bootstrap, the route mount point, the Prisma
client singleton, and graceful shutdown.

`PROD` is opt-in: only the literal string `"true"` is production, so unset, empty,
`"1"`, and `"yes"` are all development. A missing variable cannot select
production.

Two things a later task should know:

* **`src/lib/prisma.ts` imports `@prisma/client`, which does not exist until task
  3 runs `prisma generate`.** So the project does not typecheck at the end of this
  task, and claiming otherwise would be claiming a check nobody ran. Task 3 is
  what makes `tsc` meaningful; task 2's own files are complete regardless.
* **`src/routes/index.ts` mounts nothing yet.** Tasks 4 through 9 each add one
  `router.use` line there, which is why they sequence rather than parallelise.

The error envelope is the contract every later handler codes against: throw an
`ApiError`, and `errorHandler` is the only thing that writes a status. No handler
in tasks 4 through 9 should set a status code directly.

### Task 3 — feat/db-schema

Two schema files, `prisma/schema.prisma` for Postgres and
`prisma/schema.dev.prisma` for SQLite, each with the same 16 models. The 11
specified tables are as written; the 5 additive ones carry a comment naming the
endpoint each one exists for.

Migrations, in the order they run:

* `20260101000001_initial_schema` — the baseline.
* `20260101000002_single_owner_invariant` — hand-written, because Prisma cannot
  emit it. Carries `one_owner_per_org`, three "one primary per account" partial
  indexes, and the 4 `CHECK` constraints standing in for the native enum types.

**`prisma/dev-invariant.sql`** applies the same partial indexes to the SQLite
file, which supports them. The `CHECK` constraints are deliberately absent there:
`db push` would drop them on the next run, and a constraint that appears to hold
and does not is worse than none. Dev validates enums in `src/lib/enums.ts`.

Three things a later task should know:

* **The migrations are hand-written, not generated.** `prisma migrate dev` was
  never run — no network egress — so these are written to match the schema
  rather than produced by it. On the owner's first real `migrate dev`, Prisma may
  want to reconcile them. Check its output before trusting the history.
* **`organization_invites.invitee` is matched on the email string, not a foreign
  key.** An invite must be able to exist for an address that has no account yet,
  which a foreign key to `accounts` would forbid.
* **`refresh_tokens.familyId` is what makes theft detectable.** Rotation keeps
  the family id, so a replayed revoked token identifies the whole family to kill.
  Task 4 depends on that column existing.

`prisma/seed.ts` is idempotent — it resolves each entity by `name_id` and then
creates or updates, so a second run converges rather than colliding.
