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
- **Organizations and teams** with ranked roles, invites, and ownership transfer, plus
  **zero-trust access checks**: a client asks "does this user hold this role?" and gets only
  `200` or `403`.
- **Ethereum wallets.** Link wallets and sign in with Sign-In with Ethereum (EIP-4361).
- **Undeclared-route guard.** Every URL that is not on the route allowlist — including
  traversal and encoded-path tricks — gets the same `404 {"message":"Not found"}`.
- **`/api`** serves the usage page, with a dark theme by default and a light-theme toggle.

## Quick start

```bash
cp .env.example .env            # then set DATABASE_URL
docker compose up -d db
npm install && npm run build && npm start
```

Open `http://localhost:3000/api` for the API reference.

## Documentation

| Page | What it covers |
|---|---|
| [Getting started](wiki/information/getting-started.md) | Requirements, running the server, migrations |
| [Configuration](wiki/information/configuration.md) | Every environment variable, providers, proxies |
| [Client integration](wiki/information/client-integration.md) | Registering a client, logins, access checks, wallet sign-in, provider linking |
| [Security model](wiki/information/security-model.md) | What is protected and how, and the known limits |
| [Development](wiki/information/development.md) | Checks, tests, code layout, adding an endpoint |

Release notes are under [`wiki/logs/`](wiki/logs/).

## License

[MIT](LICENSE)
