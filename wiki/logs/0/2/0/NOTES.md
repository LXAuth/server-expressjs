# 0.2.0 — dependency audit

Run on 2026-11-12 with Node.js 22.23.4 and npm 10.9.9.

## Versions

`npm outdated` reports nothing: every direct dependency is at its latest version. New in
this release:

| Package | Version | Kind | Why |
|---|---|---|---|
| @noble/curves | 2.4.0 | runtime | secp256k1 public-key recovery for wallet signatures |
| @noble/hashes | 2.4.0 | runtime | keccak-256 for EIP-191 digests, EIP-55 checksums, and addresses |
| viem | 2.57.19 | development | Independent signer used by the tests to cross-check recovery |

All 0.1.0 dependencies are unchanged (see [0.1.0 notes](../../1/0/NOTES.md)).

## Audit

`npm audit` over all 267 installed packages (97 runtime): **0 vulnerabilities** at every
severity.

`npm audit signatures` still cannot run in this build environment (the registry key download
is blocked); run it where the registry is reachable.
