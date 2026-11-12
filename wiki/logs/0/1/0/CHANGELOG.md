# 0.1.0 — 2026-11-12

First release: a zero-trust central account server that any number of client
applications can log users in against.

Readers need do nothing: this is the first version.

## Added

- Email accounts with argon2id passwords, and multiple purpose-typed addresses per account
  with a per-address `login_enabled` flag.
- Developer-registered clients with a public id and a one-time-shown secret, managed with the
  owner's email and password; rename, secret rotation, and revocation.
- Login through a client, returning only `{message, session_token}`; session check, logout,
  session listing, per-session and all-other-sessions revocation, and a per-account session
  cap.
- Password change (signs out other sessions) and account deletion.
- Optional GitHub and GitLab account linking with state and PKCE, disabled cleanly when the
  provider variables are unset or left as `your_*` placeholders.
- `/api` usage page with a dark default theme and a light-theme toggle.
- PostgreSQL schema: `platforms`, `accounts`, `account_property`, `email_types`,
  `account_emails`, `clients`, `sessions`, `account_connections`, `oauth_states`,
  `audit_events`, with an advisory-locked migration runner.

## Security

- Undeclared-route guard: anything not on the route allowlist, and any traversal or encoded
  path, gets one generic `404`; a wrong method on a known path gets `405`.
- Uniform login failures with timing equalisation, temporary lockout, and per-IP rate limits.
- Session tokens, client secrets, and OAuth state stored only as SHA-256 hashes; provider
  tokens revoked after use and never stored.
- Dependency audit at release: no known vulnerabilities (see [NOTES.md](NOTES.md)).
