# Configuration

All configuration is environment variables. Copy [`.env.example`](../../.env.example) to `.env`
and edit it. Any value that starts with `your_` is a placeholder and is treated as unset, so
the example file can be used as it is for email-only accounts.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Listen address |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public URL, used to build provider callback URLs |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the server, used to read the real client IP |
| `SESSION_TTL_HOURS` | `720` | Session lifetime |
| `MAX_SESSIONS_PER_ACCOUNT` | `50` | Concurrent sessions; past this, the least recently used one is revoked |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | `5`, `15` | Temporary lockout after repeated failed logins |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | unset | Enables GitHub linking |
| `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | unset | Enables GitLab linking |
| `GITLAB_BASE_URL` | `https://gitlab.com` | A self-managed GitLab instance |

## GitHub and GitLab

Both providers are optional. With their variables unset, the server runs with email
accounts only: `GET /api/v1/connections` still lists both providers as `enabled: false`, and
starting a link answers `404`.

When you register the OAuth app with the provider, set its callback URL to:

```text
{PUBLIC_BASE_URL}/api/v1/connections/github/callback
{PUBLIC_BASE_URL}/api/v1/connections/gitlab/callback
```

## Behind a proxy

Set `TRUST_PROXY` to the number of proxies between the internet and the server. Rate limits
and audit events use the client IP, so a wrong value either groups every user under the
proxy's address or lets a client choose its own address through `X-Forwarded-For`.

Rate limits are kept in memory. When you run several instances, put a shared limit in front
of them.
