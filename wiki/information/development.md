# Development

How to check, test, and audit a change to the LXAuth server.

## Checks

```bash
npm run typecheck   # TypeScript, no output files
npm test            # vitest against PostgreSQL
npm run audit       # npm audit at every severity
```

The tests need a PostgreSQL database they can empty. They use `TEST_DATABASE_URL`, or
`postgres://lxauth:lxauth@localhost:5432/lxauth_test` when it is unset. Each suite applies the
migrations and empties every table except the seeded `platforms` and `email_types`, so the
suite can run again on the same database.

## Layout

| Path | What it holds |
|---|---|
| `src/server.ts`, `src/app.ts` | Process entry point and the Express app |
| `src/config.ts` | Environment variables, parsed and validated |
| `src/http/` | Route allowlist, security headers, authentication, rate limits, validation |
| `src/routes/` | One router per API group |
| `src/services/` | Business rules and SQL, one file per subject |
| `src/security/`, `src/web3/`, `src/oauth/` | Hashing, Sign-In with Ethereum, and provider clients |
| `src/docs/` | The `/api` page and the endpoint list it renders |
| `migrations/` | Plain SQL migrations, applied in filename order |
| `test/` | vitest and supertest suites |

## Adding an endpoint

1. Declare the route in its router under `src/routes/`. Undeclared URLs answer `404`.
2. Add its entry to `src/docs/endpoints.ts`. A test fails when the documented routes and the
   declared routes differ.
3. Add a schema change as a new file in `migrations/`, never by editing an applied one.

## Release notes

Each release has a changelog and audit notes under `wiki/logs/{Major}/{Minor}/{Patch}/`.
