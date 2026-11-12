# Client integration

How an application (a **client**) uses the LXAuth server to log users in and check what
they may do. The full request and response shapes are on the server's own `/api` page.

## Register a client

1. Create the account that will own the client:

   ```bash
   curl -X POST http://localhost:3000/api/v1/accounts \
     -H 'Content-Type: application/json' \
     -d '{"email":"dev@example.com","password":"at least 10 characters"}'
   ```

2. Register the client with that email and password over HTTP Basic:

   ```bash
   curl -X POST http://localhost:3000/api/v1/clients \
     -u 'dev@example.com:at least 10 characters' \
     -H 'Content-Type: application/json' \
     -d '{"name":"My app","redirect_uri":"https://app.example.com/linked"}'
   ```

   The answer holds `client_id` (`lxc_…`) and `client_secret` (`lxs_…`). The secret is
   shown once. Keep it on your backend; never ship it in a browser or mobile app.

## Log a user in

From your backend, send the user's email and password with the client headers:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "X-Client-Id: $CLIENT_ID" -H "X-Client-Secret: $CLIENT_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"…"}'
```

A correct login answers `200 {"message":"Login successful","session_token":"lxa_…"}`. Every
failure, whatever its cause, answers `401 {"message":"Invalid credentials"}`.

The session token only works together with the client that obtained it. Check it on later
requests with `GET /api/v1/auth/session`, sending the client headers and
`Authorization: Bearer lxa_…`. An account can hold many sessions at once, one per device or
client, and list or revoke them under `/api/v1/sessions`.

## Check access to an organization or team

To gate a feature on membership, ask with the client headers and the user's session:

```text
GET /api/v1/organizations/{id}/access?role=admin
GET /api/v1/teams/{id}/access?role=lead
```

The answer is only `200 {"message":"Access granted"}` or `403 {"message":"Access denied"}`.
An unknown organization or team gets the same `403`, so the answer reveals nothing about
who belongs to what.

Organization roles rank `owner` > `co_owner` > `admin` > `member` > `guest`; asking for a
role passes for that role and every role above it. Team roles are `lead` and `member`, and an
organization `admin` or above always passes a team check.

## Sign in with an Ethereum wallet

Set the client's `siwe_domain` (for example `app.example.com`) when you create or update it.
Then:

1. `POST /api/v1/auth/wallet/challenge` with `{"address":"0x…","chain_id":1}` returns
   `siwe_message`, a Sign-In with Ethereum (EIP-4361) message written by the server.
2. Have the wallet `personal_sign` that exact message.
3. `POST /api/v1/auth/wallet/login` with `{"message":"…","signature":"0x…"}` returns the same
   `200 {"message":"Login successful","session_token":"lxa_…"}` as an email login.

A wallet signs in only after it is linked to an account, through
`POST /api/v1/account/wallets/challenge` and `POST /api/v1/account/wallets` from a logged-in
session. A challenge works once, for ten minutes, from the client that requested it.

## Link GitHub or GitLab

With a provider configured (see [Configuration](configuration.md)), a logged-in session calls
`POST /api/v1/connections/{github|gitlab}` and sends the user to the returned
`authorize_url`. After the user approves, the server sends them back to the client's
`redirect_uri` with `provider` and `status` (`linked`, `denied`, or `error` with a `reason`)
in the query string. Linking needs the client to have a `redirect_uri`.
