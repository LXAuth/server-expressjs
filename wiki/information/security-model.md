# Security model

What the LXAuth server protects, and how. The design rule is zero trust: a client learns
whether a login or access check passed, and nothing else about the user.

## Credentials and tokens

- Passwords are hashed with argon2id. A hash made with older parameters is upgraded at the
  next successful login.
- Client secrets, session tokens, OAuth state, and invite tokens are 256-bit random values,
  stored only as SHA-256 hashes. Each has a prefix (`lxs_`, `lxa_`, `lxo_`, `lxi_`) so a
  leaked value is easy to recognise.

## Logins

- Every failed login answers the same `401 {"message":"Invalid credentials"}`. An unknown
  address still runs a password check, so the timing does not reveal which addresses exist.
- After `LOGIN_MAX_ATTEMPTS` failures the account is locked for `LOGIN_LOCK_MINUTES`.
- Sessions are bound to their client. Revoking a client ends all of its sessions, and
  changing a password ends every other session of the account.

## Organizations, teams, and wallets

- Each organization has exactly one owner, enforced by a database index. Ownership moves only
  through a transfer, and an account that owns an organization cannot be deleted.
- Member lists show profiles, never email addresses.
- Access checks answer only `200` or `403`.
- The server writes every Sign-In with Ethereum message it will accept and stores only its
  hash. Each challenge is single use and bound to one client. Signatures with a high `s`
  value are rejected.

## Provider linking

GitHub and GitLab linking uses single-use state and PKCE. Only the provider user id and
username are kept, and the provider's access token is revoked straight after use.

## Requests and responses

- Every URL that is not on the route allowlist, including traversal and encoded-path tricks,
  answers `404 {"message":"Not found"}`. A known URL with the wrong method answers `405` with
  an `Allow` header.
- Responses carry helmet security headers and `Cache-Control: no-store`. There is no CORS, no
  static file serving, and no stack trace in any response. Bodies are JSON only, up to 10 kB.
- Per-IP rate limits apply to every request, and more tightly to login, client management,
  and registration.
- Security events (logins, failures, lockouts, revocations, and changes) are written to the
  `audit_events` table.

## Known limits

- Email addresses are not verified, since there is no mail service yet. Registration
  therefore reports an address that is already taken with `409`.
- Rate limits are in memory, per instance.
