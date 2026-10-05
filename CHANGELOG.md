# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Everything below shipped in one sitting and has **never been run**. No migration
was applied, no test executed, no request served. Treat it as a code drop rather
than a release, and read the caveats at the bottom before deploying it.

### Added

* **Express 5 application on TypeScript**, ESM, strict mode, with graceful
  shutdown, request ids, and a single error envelope shared by every endpoint.
* **PostgreSQL in production, SQLite in development**, from one set of Prisma
  schemas resolved by `prisma.config.ts`.
* **16 tables** — the 11 specified in the brief plus 5 additive ones, each
  carrying a comment naming the endpoint it exists for.
* **Auth**: register, login, refresh, logout, `verify-token`.
  * Access tokens are stateless and short-lived; permissions ride in the claims,
    so `verify-token` answers without touching the database.
  * Refresh tokens are opaque, hashed at rest with a pepper, and rotate on every
    use. Replaying a spent token revokes the entire family.
  * argon2id password hashing with an opportunistic rehash on login.
* **Users**: profile, password change, emails with verification, addresses,
  organization listing.
* **Organizations**: CRUD, member listing, invite, join, role updates, member
  removal.
* **Teams**: CRUD plus team membership, scoped to their organization on every
  query.
* **Wallets**: bind, list, set-primary, unbind, under `/accounts/{account_id}`.
* **Web3 login**: single-use challenge, signature verification, login.
* **Memberships**: tier read and upgrade behind a payment provider interface.
* **Integration test suite** over the real schema, including explicit cases for
  `verify-token` and the single-owner invariant.

### Security notes

* **`verify-token` performs no database lookup.** Every internal microservice
  calls it, so a query per call would make the identity provider the bottleneck it
  was meant to remove. The accepted cost: a suspension takes effect no sooner than
  the access token expires, which is why the lifetime is 15 minutes.
* **Single-owner is a database constraint.** `one_owner_per_org` is a partial
  unique index in a hand-written migration. Two concurrent promotions both pass
  their application checks, and the index is what decides. The application code
  produces a good error; it does not hold the guarantee.
* **JWT algorithms are pinned** to HS256. An `alg: none` token is rejected.
* **Login resists account enumeration** two ways: identical response bodies, and
  a throwaway argon2 hash for unknown accounts so timing does not distinguish
  them either.
* **Wallet binding requires a signature** over a message naming the account id and
  a single-use nonce. `wallet_address` is globally unique, so one key cannot
  front two accounts.
* **Web3 login recovers the signing address** rather than trusting the request
  body. Using the claimed address to look up the account first would let anyone
  holding any private key log in as anyone.
* **Log-level failures never leak their cause** — a generic 500 with a request id,
  with the real error correlated in the log.

### Known gaps

* **Web3 sign-in and wallet binding do not work.** No secp256k1 recovery
  implementation is installed and the build environment had no network access to
  add one. Every web3 endpoint answers `503 signature_unavailable`. Adding
  `ethers` or `@noble/curves` and implementing `RecoveryFn` in
  `src/lib/signature.ts` is the whole of the remaining work; keccak256, EIP-191
  framing, and signature validation are already complete.
* **No test has ever been run.** `npm install` never completed. Expect failures on
  the first real run.
* **The migration history is hand-written**, not generated — `prisma migrate dev`
  was never run. Check its output on the first real migration before trusting the
  history.
* **Enums are `VARCHAR` columns, not native Postgres enum types.** Prisma cannot
  declare an enum on SQLite, and the datasource `provider` must be a literal.
  Postgres gets `CHECK` constraints in a migration; development validates in
  TypeScript. The full type safety of native enums is gone, by design, to avoid
  maintaining two schema files that drift apart.
* **`membership/upgrade` always refuses.** No payment gateway was named in the
  brief and none is integrated. The default provider declines rather than
  reporting a fake success.
* **SQLite development has no `CHECK` constraints.** `db push` drops them. Enum
  values are validated in `src/lib/enums.ts` instead.
* **Membership history is not retained.** One row per account, updated in place,
  because that is the specified table's shape.
* **No mail transport.** Verification and invite tokens are returned in the
  response so they can be exercised. A deployment with mail returns nothing there.
* **`Int` account ids, not `BigInt`.** The specified DDL says `SERIAL`. This is a
  one-way door: once wallets, memberships, and audit rows reference `account_id`,
  changing it is a migration across every table.