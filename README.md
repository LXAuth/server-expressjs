# LXAuth server

A zero-trust central account server. Developers register their applications as
**clients**; every client asks this server whether a login is correct, and the server
answers with a status and a message — never with the user's data. One account works
across any number of clients.

- **Email accounts** with argon2id passwords, and several addresses per account, each with
  a purpose (`primary`, `recovery`, `notification`, `receipt`, `other`).
- **Client-bound sessions.** A login returns `200 {"message", "session_token"}`. The token
  is opaque and only works from the client that obtained it. An account can hold many
  sessions at once, each listable and revocable.
- **Optional GitHub and GitLab linking.** Leave their variables unset and the server runs
  with email accounts only.
- **Undeclared-route guard.** Every URL that is not on the route allowlist — including
  traversal and encoded-path tricks — gets the same `404 {"message":"Not found"}`.
- **`/api`** serves the usage page, with a dark theme by default and a light-theme toggle.

## Requirements

- Node.js 22.12 or later
- PostgreSQL 14 or later (a `docker-compose.yml` for PostgreSQL 18 is included)

## Run it

```bash
cp .env.example .env            # then set DATABASE_URL and, optionally, providers
docker compose up -d db         # or point DATABASE_URL at your own PostgreSQL
npm install
npm run build
npm start                       # applies migrations, then listens on PORT
```

Open `http://localhost:3000/api` for the API reference.

For development, `npm run dev` runs the TypeScript source with reload.

## Configuration

All configuration is environment variables; see [`.env.example`](.env.example). Any value
that starts with `your_` is a placeholder and is treated as unset.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Listen address |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public URL, used for provider callback URLs |
| `TRUST_PROXY` | `0` | Reverse proxies in front of the server, for the real client IP |
| `SESSION_TTL_HOURS` | `720` | Session lifetime |
| `MAX_SESSIONS_PER_ACCOUNT` | `50` | Concurrent sessions; the least recently used is revoked past this |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | `5`, `15` | Temporary lockout after repeated failures |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | unset | Enables GitHub linking |
| `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | unset | Enables GitLab linking |
| `GITLAB_BASE_URL` | `https://gitlab.com` | Self-managed GitLab instance |

When registering an OAuth app with GitHub or GitLab, set its callback URL to
`{PUBLIC_BASE_URL}/api/v1/connections/{github|gitlab}/callback`.

## How a client uses it

1. Create an account: `POST /api/v1/accounts`.
2. Register a client with your own email and password (HTTP Basic):
   `POST /api/v1/clients` → `client_id` and `client_secret`, shown once.
3. From your backend, log users in: `POST /api/v1/auth/login` with
   `X-Client-Id` and `X-Client-Secret` → `200 {"message":"Login successful","session_token":"lxa_…"}`.
4. On later requests, check the session: `GET /api/v1/auth/session` with the client
   headers and `Authorization: Bearer lxa_…`.

The client secret belongs on a server. Do not ship it in a browser or mobile app.

## Security model

- Passwords are hashed with argon2id. Client secrets, session tokens, and OAuth state are
  256-bit random values stored only as SHA-256 hashes.
- Every failed login returns the same `401 {"message":"Invalid credentials"}`, with a dummy
  password check for unknown addresses so timing does not reveal which addresses exist.
- Sessions are bound to their client; revoking a client ends all of its sessions; changing a
  password ends every other session.
- Provider linking uses single-use state and PKCE. Only the provider user id and username are
  kept, and the provider's access token is revoked straight after use.
- Responses carry helmet security headers and `Cache-Control: no-store`; there is no CORS, no
  static file serving, and no stack trace in any response. Bodies are JSON only, capped at 10 kB.
- Per-IP rate limits apply globally and, more tightly, to login, client management, and
  registration. They are in-memory: put a shared store in front when running several
  instances.
- Security events (logins, failures, lockouts, revocations, changes) are written to the
  `audit_events` table.

Known limits in 0.1.0: email addresses are not verified (no mail service yet), so
registration reports an address that is already taken with `409`.

## Development

```bash
npm run typecheck
npm test          # needs PostgreSQL; set TEST_DATABASE_URL (default
                  # postgres://lxauth:lxauth@localhost:5432/lxauth_test)
npm run audit
```

## License

[MIT](LICENSE)
