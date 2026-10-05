# LXAuth server

A TypeScript identity provider on Express 5 and Prisma. PostgreSQL in
production, SQLite in development, one schema for both.

It issues and verifies access tokens, manages users, organizations and teams,
binds Ethereum wallets, and answers `verify-token` for internal microservices
that need to know who is calling without becoming a dependency on a database
query.

## Status

This is a first release built in an environment with **no network access**, which
shaped two things you should know before reading further.

**Web3 sign-in and wallet binding do not work.** Verifying an Ethereum signature
requires recovering a public key with secp256k1 arithmetic, and no secp256k1
library is installed — the environment could not install one. Every web3 endpoint
answers `503 signature_unavailable` rather than appearing to work. Everything
around that is complete: keccak256, the EIP-191 framing, address normalisation,
and signature format validation. Adding `ethers` or `@noble/curves` and
implementing one function finishes it.

**No test has ever been run.** `npm install` never completed, so `vitest` has
never executed. The suite in `tests/` is written and unexecuted; expect failures
on the first real run, particularly until `prisma generate` has run. The
migration history in `prisma/migrations/` is hand-written rather than generated,
so check the output of your first `migrate dev` before trusting it.

Nothing here has been exercised against a live database.

## Requirements

Node 20.11 or newer. PostgreSQL 14+ for production; development needs nothing
beyond Node.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:push
npm run dev
```

`db:push` syncs the SQLite file at `prisma/dev.db`. The partial unique indexes
that carry the single-owner guarantee are **not** applied by `db push` — apply
them once, or the invariant exists only in application code:

```bash
sqlite3 prisma/dev.db < prisma/dev-invariant.sql
```

Re-run that after every `db:push`, which drops anything it did not create.

Then:

```bash
curl localhost:3000/health
```

### Against PostgreSQL

```bash
PROD=true npm run db:deploy   # applies the real migration history
PROD=true npm run build && npm start
```

`PROD=true` switches `prisma.config.ts` to the PostgreSQL schema, applies the
`CHECK` constraints that stand in for native enum types, and requires
`DATABASE_URL`. Only the literal string `"true"` is production — unset, `"1"`,
and `"yes"` are all development, so a missing variable cannot point production
code at a SQLite file.

## Configuration

Every variable is documented in `.env.example`. The ones that matter most:

| Variable | Notes |
|---|---|
| `PROD` | Only `"true"` is production. Defaults to development. |
| `DATABASE_URL` | Required in production. |
| `JWT_ACCESS_SECRET` | Required always, including in development. |
| `JWT_REFRESH_SECRET` | Required always. |
| `TOKEN_PEPPER` | Rotating it invalidates every session and invite at once. |
| `WEB3_DOMAIN` | Appears in the signed message. Must match the client's view. |

## Running the tests

```bash
npm test
```

Each test file gets its own SQLite database, with the partial unique indexes
applied. Before release, run it once against PostgreSQL — that is the only run
that exercises the `CHECK` constraints, since `db push` applies no migrations:

```bash
TEST_DATABASE_URL=postgresql://lxauth:lxauth@localhost:5432/lxauth_test \
  npm run db:deploy && npm test
```

## How it is put together

```
src/
  config.ts          environment, validated once at boot
  app.ts             builds the Express app; server.ts listens
  lib/               enums, errors, crypto, password, tokens, signature, payment
  middleware/        authenticate, error envelope
  modules/           one directory per feature group: routes, controller, service, schemas
prisma/
  schema.prisma      PostgreSQL
  schema.dev.prisma  SQLite — the same 16 models
  migrations/        hand-written, including the partial unique indexes
tests/
```

Two conventions worth knowing before reading the code:

**Services do the work; controllers only shape.** No handler sets a status code
directly — they throw an `ApiError` and one middleware writes the response. That
keeps the rules reachable from a future CLI or background job without going
through HTTP.

**Authorization lives in the service, not the route.** It cannot always live in
the route, because `wallets.account_id` and `account_memberships.account_id`
point at `accounts`, which is polymorphic. A caller may manage their own
account's wallets and an organization owner's wallets, and that is not a question
the token alone can answer.

## Design decisions worth knowing

**`verify-token` does no database lookup.** Every internal microservice calls it,
so a query per call would make the identity provider the bottleneck it was meant
to remove. Permissions are derived from the JWT claims. The cost: a suspension
takes effect no sooner than the access token expires, which is why the lifetime
is 15 minutes rather than an hour.

**Refresh tokens rotate, and replay kills the family.** Presenting an
already-revoked token means either a client retry or theft, and the two are
indistinguishable from here — so the whole token family is revoked, including
the honest client's. That costs one re-login and costs a thief everything.

**The single-owner guarantee is a database constraint, not application logic.**
Two concurrent promotions both read "the owner is X" and both promote. Only a
partial unique index decides that race. The application code exists to produce a
good error, not to hold the line.

**Enums are `VARCHAR` columns, not native types.** Prisma cannot declare an enum
on SQLite, and the datasource `provider` has to be a literal, so one schema file
cannot keep native enums on one side. The values live in `src/lib/enums.ts`;
Postgres gets `CHECK` constraints in a migration. Dev validates in TypeScript —
SQLite's `db push` would drop `CHECK` constraints, and a constraint that appears
to hold and does not is worse than none.

**A team is scoped to its organization on every query.** `GET
/organizations/1/teams/7` returns 404 if team 7 belongs to organization 2, even
when the caller owns both. A bare lookup on the team id would return it.

Full detail, including what was deliberately left out, is in
`.agents/memory/tasks/lxauth-backend.md`.

## API

`docs/API.md` lists every endpoint. Errors share one envelope:

```json
{ "error": { "code": "not_found", "message": "Wallet 7 not found.", "details": {} } }
```

`code` is stable and safe to branch on. `message` is for humans and may change.
Unexpected failures return a generic 500 with a request id; the cause goes to the
log, correlated by that id.