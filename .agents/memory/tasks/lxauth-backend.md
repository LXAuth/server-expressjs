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

### Task 4 — feat/auth-core

argon2id hashing with an opportunistic rehash on login, opaque refresh tokens
hashed at rest with a pepper, JWT access tokens carrying the org roles, and the
four auth endpoints.

**Refresh rotation with family kill.** Every refresh issues a new token, marks
the old one revoked, and keeps the `family_id` from task 3. Presenting an
already-revoked token means either a client replay or a theft, and the two look
identical from here — so the whole family is revoked, including the token the
honest client is holding. That costs a legitimate user one re-login and costs a
thief the entire stolen lineage.

**`verify-token` does no database lookup.** Verified by reading the handler:
it calls `verifyAccessToken`, then `buildVerifyTokenResult`, and nothing else.
The accepted trade is that a suspension takes effect no sooner than the access
token expires, which is why the lifetime is 15 minutes rather than an hour.
`derivePermissions` computes the caller's permissions from the claims so a
microservice gets its answer without the database being involved.

**Login resists account enumeration two ways.** An unknown email, an account
with no password, and a wrong password all produce the same 401 body — and the
first two additionally run a throwaway argon2 hash, so response time does not
distinguish them either.

Two things later tasks should know:

* **`assertAccountUsable` and `requireOrgRole` live in `src/lib/claims.ts`.** A
  deleted account is kept as a row so audit references stay resolvable, so
  refusing it is explicit in `assertAccountUsable` rather than left to a missing
  row. Task 5's password change must call `revokeAllSessions` from the auth
  service — changing a password that leaves old sessions alive is not a
  password change.
* **`AccessTokenClaims` now carries `exp`.** `verify-token` reports the token's
  real expiry from that claim rather than recomputing one.

### Task 5 — feat/users

Register, me get/update, password change, organization listing, emails with
verification, and addresses.

Three decisions worth keeping:

* **`PUT /users/me/password` revokes every session.** A password change that
  leaves old refresh tokens alive is not a password change. The response reports
  how many sessions *remain*, because the caller's own session is among those
  revoked and it can no longer use the old token to discover that.
* **`POST /users/me/emails` has no `isPrimary` field, deliberately.** An
  unverified address cannot be primary — otherwise an account could demote its
  real address in favour of an unverified one and lock itself out. Promotion is
  its own endpoint and requires `isVerified`.
* **`POST /users/me/emails/verify` is an addition to the specified paths.** There
  is no mail transport in this build, so `register` and `addEmail` return the
  verification token in the response. An endpoint that produces a token with no
  way to redeem it would leave verification unreachable, so this was added rather
  than left broken. In a deployment with mail it becomes the link target.

Registration writes the account, primary email, credentials, and free membership
in one transaction — all four or none, since an account with no credentials
cannot log in and one with no email cannot be verified.

### Task 6 — feat/organizations

Organization CRUD, member listing with pagination, invite/join, role updates, and
member removal.

**How the owner invariant is actually held.** `one_owner_per_org` from task 3 is
the guarantee; the code here only produces good errors. Two places depend on the
ordering that index forces:

* *Creating* an organization writes the creator's `owner` row in the same
  transaction. Splitting them leaves a window where the organization exists with
  no owner, which is unrecoverable — the index permits zero owners as readily as
  two, and nothing else can repair it.
* *Promoting* to owner demotes the current owner to `co_owner` first, then
  promotes, both in one transaction. Demotion must come first because the
  intermediate state of two owners would fail inside the transaction too.

Two concurrent promotions both read "current owner is X", both try to demote X
and promote their own target; the transactions serialise and the loser's insert
violates the index, which surfaces as a `last_owner` 409 rather than a 500.

**Other decisions:**

* **An invite cannot grant `owner`** — the schema excludes it. Ownership
  transfers by promoting an existing member, which goes through the index.
* **`join` requires the redeeming account to hold a verified copy of the invited
  email.** Without that check a leaked invite link is a transferable membership.
* **Admins cannot escalate.** An admin may not invite or promote to `admin`,
  `co_owner`, or `owner`, and may not remove a peer.
* **`DELETE /organizations` is a soft delete** — status becomes `deleted` rather
  than the row going away, because audit rows elsewhere reference account ids.
* **No `description` field on organizations.** The specified DDL gives an
  organization none — only `organization_teams` has one — and the brief says not
  to restructure the specified tables. Accepting a field and discarding it would
  be worse than refusing it, so it is not in the contract. Adding it needs a
  migration, which is the owner's call.

**Task 7 must mount `/:org_id/teams` before the `/:org_id` routes**, or Express
will let `/:org_id` swallow `/12/teams`.

### Task 7 — feat/teams

Team CRUD plus team membership, mounted at `/:org_id/teams` from the organization
router as task 6 required.

Two checks worth keeping:

* **Every operation confirms the team belongs to the organization in the path.**
  A bare `findUnique` on the team id would let `GET /organizations/1/teams/7`
  return a team belonging to organization 2 — a cross-tenant read that only the
  `organizationId` filter prevents.
* **Adding someone to a team requires organization membership first.** A team is
  a grouping inside an organization; a team member who is not an organization
  member would hold no role in the owning organization, so their access token
  would grant nothing.

A team's `role` column is free-text `VARCHAR(50)` in the specified DDL, not an
enum, so unlike organization roles it has no set in `src/lib/enums.ts`. It is
constrained to `member | lead` in the request schema and defaults to `member`.

### Task 8 — Web3

The wallet login handshake and wallet management.

**The endpoints exist and refuse to work. Signature verification is not
implemented.** Recovering a signer's public key from an ECDSA signature requires
secp256k1 point arithmetic, and no secp256k1 library is installed — the build
environment has no network egress, so `ethers` or `@noble/curves` could not be
added. Hand-writing it would mean a few hundred lines of security-critical
elliptic curve code whose worst failure mode is accepting a forged signature, so
it is absent rather than guessed at.

What that means concretely: **every web3 endpoint answers 503
`signature_unavailable`**, including `POST /auth/web3/nonce`, which refuses before
handing out a challenge the client could never redeem. Nothing in this group has
been exercised end to end and no claim is made about it working.

**What is complete and reviewable:** keccak256 (not SHA-3 — different padding),
the EIP-191 personal-sign framing, address normalisation, and signature format
validation including the EIP-2 low-`s` rule. `recoverSigner` is an injected
`RecoveryFn` with no implementation installed. To finish this: add `ethers` or
`@noble/curves`, then implement `RecoveryFn` and call `setRecoveryFn` once at
boot in `src/server.ts`. Nothing else changes.

**Single-use is in the database, not the handler.** `consumeNonce` is an
`updateMany` with `consumedAt: null` in the filter, so two concurrent requests
carrying the same valid signature produce one winner — the second matches no row.
A read-then-write would let both proceed.

**The signing address is recovered, not trusted.** Login looks the account up
from the address the signature recovers, never from the request body. Ordering it
the other way would let anyone holding any private key log in as any account.

**Login and bind challenges are different and not interchangeable.** A login
challenge stores `account_id: null` because there is no account yet; a bind
challenge names the account it is for. Login refuses a challenge with an account
id, and bind refuses one without, so a signature collected in one flow cannot be
redeemed in the other. Both messages are rebuilt from stored state at verification
time — a client cannot supply the text it signed.

**Wallet authorization is per-account, and centralised in
`requireWalletAdmin`.** `wallets.account_id` points at `accounts`, which is
polymorphic, so "may this caller act here?" cannot be answered from the token.
A user account admits only its owner — not even an administrator. An organization
account admits `co_owner` and above: `admin` is deliberately below the bar,
because binding a wallet is how an organization proves who controls it and that
should rank with moving its money.

**`walletAddress` was removed from the register schema.** Task 5 accepted it and
ignored it. A bind signature covers the account id, which does not exist until
registration runs, so honouring it would mean binding without that signature.
Register, then bind.

Three things to know:

* **`keccak256` is hand-written** and therefore unverified. It has known test
  vectors; they are in task 10's suite as a pure unit test with no database.
* **`/wallets/nonce` requires `address`.** An earlier draft built the message with
  a placeholder, which is text the client cannot usefully sign.
* **Removing the primary wallet promotes the oldest remaining one**, so an account
  is never left holding wallets with none of them primary. Removing the last wallet
  is allowed — refusing would leave an account permanently unbindable.

### Task 9 — Memberships

Tier read and upgrade, mounted at `/accounts/{account_id}/membership`.

**No gateway is integrated, and the default provider declines every upgrade.**
`src/lib/payment/provider.ts` holds the `PaymentProvider` interface and a
`NoopPaymentProvider` whose `isAvailable()` returns false. No gateway SDK is
imported anywhere. `POST /membership/upgrade` therefore answers 402
`payment_failed` and writes nothing, which is the correct outcome: an upgrade
path that silently succeeds in development hands out paid tiers for free the
first time it meets a real customer.

**Availability is checked before charging**, not inferred from the outcome — a
provider that is not wired up is a different problem from a declined card and the
two deserve different messages. `charge` declining as well is defence in depth,
not the primary gate.

**The provider is called before the tier is written.** The reverse order means a
declined card leaves an account on the tier it just tried to pay for, and the
refund becomes somebody's problem. This way a failed charge leaves the account
exactly where it was, which is the state that is always safe to be in.

**Authorization reuses `requireWalletAdmin` rather than repeating the rule.** "May
this caller manage this account's wallets" and "may this caller change this
account's plan" are the same question; a second implementation is a second place
for it to drift.

**Upgrades only, ranked.** free < premium < enterprise. A downgrade is refused
rather than performed, because proration is a refund policy and this build has no
answer for one. Requesting the tier an account already holds is a 409, so a
retried request does not become a second purchase.

**One row per account, updated in place** — that is the specified table's shape.
A consequence worth knowing before anyone relies on it: **there is no history of
tier changes.** `time_start`/`time_end` bound the current period, not a log. If
billing reconciliation needs that, it needs a new table, which is the owner's
call. An upgrade clears `time_end`, so a lapsed membership revives rather than
sitting in a state that reads as both "enterprise" and "expired".

### Task 10 — test/integration

Seven files: `helpers`, `auth`, `users`, `organizations`, `owner-invariant`,
`verify-token`, `web3`, `memberships`, `signature`. Run with `npm test`.

**These tests have never been run. No test in this repository has a result
behind it.** The build environment has no network egress, so `npm install` never
completed and `vitest` never executed — not once, not partially, not for one
file. Every assertion in `tests/` is an assertion someone wrote and nobody
watched hold. Expect failures on the first real run: the schema was never
generated (`@prisma/client` does not exist yet), and hand-written tests carry
real mistakes. **Do not read a green run as evidence this task was previously
verified.**

To run them:

```
npm install
npm run db:generate
npm test
```

That gives a SQLite file per test file, with `prisma/dev-invariant.sql` applied
so the partial unique indexes are present. **Run once against Postgres before
release** — that is the only run that exercises the `CHECK` constraints from
`20260101000002_single_owner_invariant`, since `db push` applies no migrations
and a dev database therefore never has them:

```
TEST_DATABASE_URL=postgresql://lxauth:lxauth@localhost:5432/lxauth_test \
  npm run db:deploy && npm test
```

Point that at a database you are willing to have emptied; `resetDatabase` wipes it.

**Two tests exist because the plan called for them, and they earn it:**

* `verify-token.test.ts` — valid token returns permissions; expired, tampered,
  wrong-secret, wrong-audience, and `alg: none` are all rejected; the expiry
  reported is the token's own. The "no database lookup on the happy path"
  constraint is *not* asserted here — it is a statement about what the code does
  not do, so it is a code-reading check, and task 4 recorded it as one.
* `owner-invariant.test.ts` — the central case writes two owner rows **directly
  through Prisma, bypassing the service**, and asserts the database refuses with
  `P2002`. That is the test that matters: if it passes, the invariant holds
  regardless of what the endpoint code does. The endpoint tests around it confirm
  the code cooperates rather than being trusted to carry the weight.

**`web3.test.ts` asserts the current non-functional state.** Its first case is
`expect(isRecoveryAvailable()).toBe(false)`, and the web3 cases assert 503
`signature_unavailable`. A suite that only tested the happy path would look green
while the feature was entirely unusable. If someone wires up a recovery library,
that first test fails deliberately — forcing this file to be rewritten, because
by then its cases would be asserting the wrong thing.

**`signature.test.ts` needs no database** and is the one file that can be trusted
soonest. It carries the known keccak256 vectors, a check that keccak differs from
NIST SHA-3, EIP-2 low-`s` enforcement, and the 64-byte-signature rejection.
keccak256 is hand-written, so these vectors are the only thing between it and a
silent wrong answer.
