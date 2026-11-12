# 0.1.0 — dependency audit

Run on 2026-11-12 with Node.js 22.23.4 and npm 10.9.9.

## Versions

Every direct dependency was installed at its latest published version, and
`npm outdated` reports nothing.

| Package | Version | Kind |
|---|---|---|
| express | 5.3.0 | runtime |
| helmet | 8.3.0 | runtime |
| express-rate-limit | 8.7.4 | runtime |
| zod | 4.6.7 | runtime |
| argon2 | 0.45.2 | runtime |
| pg | 8.23.1 | runtime |
| typescript | 7.0.2 | development |
| tsx | 4.23.15 | development |
| vitest | 5.1.0 | development |
| supertest | 7.3.2 | development |
| @types/express | 5.0.6 | development |
| @types/node | 26.6.6 | development |
| @types/pg | 8.23.1 | development |
| @types/supertest | 7.2.1 | development |

## Audit

`npm audit` over all 247 installed packages (95 runtime): **0 vulnerabilities** at every
severity. `npm audit --omit=dev` gives the same result.

`npm audit signatures` could not run: the build environment's network blocked the registry
key download (HTTP 403). Run it once where the registry is reachable.

## Notes

- `@types/node` tracks the newest Node.js line, ahead of the 22.x minimum in `engines`.
  Type-checking against it does not stop the code from using an API that Node 22 lacks;
  the test suite runs on Node 22 to catch that.
- `argon2` ships prebuilt native binaries; no compiler is needed on supported platforms.
