# API reference

All paths are prefixed with `/api/v1`. Request and response bodies are JSON.

Authentication is a bearer token, sent as `Authorization: Bearer <token>`. Browser
clients that cannot set a header on a navigation may pass it as an `access_token`
cookie instead.

## Conventions

**Errors** use one envelope:

```json
{ "error": { "code": "forbidden", "message": "...", "details": {} } }
```

`code` is the stable contract. `message` is for humans and may change without
notice. Internal failures never leak their cause — they return a generic 500 with
a `requestId`, and the real cause is logged under that id.

| Code | Status | Meaning |
|---|---|---|
| `bad_request` | 400 | The request was understood but is wrong. |
| `validation_failed` | 422 | A field failed its schema. `details` names them. |
| `unauthorized` | 401 | No usable credential. |
| `invalid_credentials` | 401 | Password login failed. Deliberately indistinguishable from an unknown account. |
| `token_expired` | 401 | Refresh and retry. |
| `token_invalid` | 401 | Re-authenticate. |
| `forbidden` | 403 | Authenticated, not permitted. |
| `not_found` | 404 | Absent, or not yours to see. |
| `conflict` | 409 | The current state forbids this. |
| `already_exists` | 409 | Uniqueness violation. |
| `last_owner` | 409 | An organization must always have exactly one owner. Promote someone else first. |
| `payment_failed` | 402 | The charge was declined or no provider is configured. Nothing was written. |
| `signature_unavailable` | 503 | This build cannot verify signatures. Not a rejected signature — see below. |
| `rate_limited` | 429 | Too many requests. |
| `internal_error` | 500 | Unexpected. Check the `requestId` in the log. |

**Organization roles** rank `owner` > `co_owner` > `admin` > `member` > `guest`.
`guest` can read an organization it was invited to and holds no management rights.

**Tiers** rank `free` < `premium` < `enterprise`.

**Pagination.** List endpoints accept `limit` (default 50, max 100) and `offset`
(default 0) as query parameters, and return `{ items, total, limit, offset }` or
a named collection plus those counts.

**Not-found covers "not yours".** Several endpoints return 404 rather than 403
for a resource belonging to another account. That is deliberate: a 403 confirms
the resource exists, which is itself a leak.

---

## Health

### `GET /health`

Unauthenticated. Liveness, environment, and uptime. Not a readiness check — it
does not touch the database.

## Auth and session

### `POST /auth/login`

Email and password → a token pair. Unauthenticated.

```json
{ "email": "user@example.com", "password": "..." }
```

An unknown email, an account with no password, and a wrong password all return
the same 401 with the same body, and the first two spend comparable time
verifying a throwaway hash so latency does not distinguish them either.

An unverified email is refused with 403.

**200**

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "accessTokenExpiresIn": 900,
  "refreshTokenExpiresAt": "2026-11-04T12:00:00.000Z",
  "tokenType": "Bearer",
  "account": { "accountId": 1, "email": "user@example.com", "type": "user" }
}
```

### `POST /auth/refresh`

Exchanges a refresh token for a new pair, rotating the old one. Unauthenticated.

```json
{ "refreshToken": "..." }
```

Presenting an already-rotated token revokes **the entire token family**,
including the caller's live token, and returns 401. A replay is indistinguishable
from theft, so theft is assumed.

### `POST /auth/logout`

Revokes a session, or every session with `allSessions`. Unauthenticated.

```json
{ "refreshToken": "...", "allSessions": false }
```

Always 204, even for a token that was never valid — reporting failure would make
this an oracle for testing whether a token existed.

### `POST /auth/verify-token`

The Zero Trust core. Unauthenticated, because it is the thing that authenticates.

```json
{ "token": "eyJ..." }
```

**No database lookup.** Everything needed to answer is in the claims. The
consequence: an account suspended a second ago still passes until its access
token expires, which is why access tokens live 15 minutes.

**200**

```json
{
  "valid": true,
  "accountId": 1,
  "accountType": "user",
  "accountStatus": "active",
  "permissions": ["account:read", "account:write", "org:1:read", "org:1:delete"],
  "organizations": [{ "organizationId": 1, "role": "owner" }],
  "expiresAt": 1791214800
}
```

Permission names are namespaced so a caller can check one without parsing a role:
`org:{id}:read`, `org:{id}:write`, `org:{id}:delete`, `org:{id}:members`,
`org:{id}:teams`, `account:read`, `account:write`, `account:wallets`,
`membership:read`, `membership:write`.

Returns 401 with `token_expired` or `token_invalid`. The algorithm is pinned to
HS256; an `alg: none` token is rejected.

**This endpoint should not be exposed on a public interface.** Anyone who can
reach it can read any token's claims, which is the intended arrangement for
internal services.

## Web3 login

> **Both endpoints currently answer `503 signature_unavailable`.** This build has
> no secp256k1 recovery implementation, so no signature can be checked. That is a
> property of the deployment, not of your request — a 503 here does not mean your
> signature was wrong. `POST /nonce` refuses up front rather than issuing a
> challenge that could never be redeemed.

### `POST /auth/web3/nonce`

Issues a single-use challenge. Unauthenticated.

```json
{ "chain": "ethereum", "address": "0x..." }
```

`address` is optional. **201** returns `nonce`, `chain`, `expiresAt`, and the
exact `message` to sign — sent rather than described so the client cannot
reconstruct it slightly differently.

### `POST /auth/web3/login`

Verifies the signature against the challenge and returns a token pair.
Unauthenticated.

```json
{ "chain": "ethereum", "address": "0x...", "nonce": "...", "signature": "0x..." }
```

The signing address is recovered from the signature, never taken from the
request. A signature is valid forever, which is what the single-use nonce exists
to prevent.

Returns 404 if the address is not bound to an account — bind it first.

## Users

### `POST /users`

Register. Unauthenticated.

```json
{ "email": "user@example.com", "password": "...", "nameId": "@handle", "nameDisplay": "Handle" }
```

Passwords must be at least 12 characters. Writes the account, primary email,
credentials, and free membership in one transaction — all four or none.

**201** returns `accountId` and `verificationToken`. The token is in the response
because this build has no mail transport; a deployment with mail sends it and
returns nothing.

There is no `walletAddress` field. Binding a wallet requires a signature over
the account id, which does not exist until registration has run — so register
first, then bind.

### `GET /users/me`

The authenticated account with emails and addresses. Never returns a password
hash.

### `PUT /users/me`

Display name and avatar only.

```json
{ "nameDisplay": "New Name", "avatarUrl": "https://..." }
```

### `PUT /users/me/password`

```json
{ "currentPassword": "...", "newPassword": "..." }
```

**Revokes every session**, including the caller's own. A password change that
leaves old refresh tokens alive is not a password change. The response reports
`sessionsRevoked` — the number *remaining*, which is normally 0.

### `GET /users/me/organizations`

Organizations the caller belongs to, with their role.

### `GET /users/me/emails`

The account's email addresses.

### `POST /users/me/emails`

Adds an address. **201** returns the verification token.

```json
{ "email": "other@example.com" }
```

There is deliberately no `isPrimary` field. An unverified address cannot be
primary — otherwise an account could demote its real address in favour of an
unverified one and lock itself out.

### `POST /users/me/emails/verify`

Redeems a verification token. **This endpoint is an addition to the specified
paths** — without it, the tokens returned above would have no way to be spent.

```json
{ "token": "..." }
```

### `PUT /users/me/emails/{email_id}/primary`

Promotes an address. Requires it to be verified.

### `GET /users/me/addresses` · `POST /users/me/addresses`

```json
{ "address": "1 Example Street", "isPrimary": false }
```

The first address added becomes primary automatically.

## Organizations

All require authentication, and all require membership in the organization named
in the path.

### `POST /organizations`

Creates an organization with the caller as owner.

```json
{ "nameId": "@acme", "nameDisplay": "Acme" }
```

There is no `description` field. The specified schema gives an organization none
— only a team has one — and adding a column is a migration.

The owner row is written in the same transaction as the organization. Splitting
them leaves a window where the organization exists with no owner, which is
unrecoverable.

### `GET /organizations/{org_id}` · `PUT` · `DELETE`

Reads, updates, and soft-deletes. Delete sets status to `deleted` rather than
removing the row, because audit rows elsewhere reference account ids.

### `GET /organizations/{org_id}/members`

Members with roles. Paginated.

### `POST /organizations/{org_id}/members/invite`

```json
{ "email": "someone@example.com", "role": "member" }
```

**201** returns the invite token, for the same no-mail reason as above.

The role cannot be `owner`. Ownership transfers by promoting an existing member,
which goes through the single-owner index — handing it out here would bypass it.

### `POST /organizations/{org_id}/members/join`

```json
{ "token": "..." }
```

Requires the redeeming account to hold a **verified** copy of the invited email.
Without that check a leaked invite link is a transferable membership.

### `PUT /organizations/{org_id}/members/{user_id}/role`

```json
{ "role": "admin" }
```

Admins cannot escalate: an admin may not promote to `admin`, `co_owner`, or
`owner`, and may not remove a peer.

Promoting to `owner` demotes the current owner to `co_owner` first, in one
transaction. Two concurrent promotions both pass their checks and the index
decides; the loser gets a 409 `last_owner`, not a 500.

### `DELETE /organizations/{org_id}/members/{user_id}`

Removes a member. The last owner cannot be removed — 409 `last_owner`.

## Teams

Mounted at `/{org_id}/teams`. Every operation confirms the team belongs to the
organization in the path, so `GET /organizations/1/teams/7` returns 404 when team
7 belongs to organization 2, even if the caller owns both.

### `GET` · `POST /organizations/{org_id}/teams`

```json
{ "nameId": "@engineering", "nameDisplay": "Engineering", "description": "..." }
```

### `GET` · `PUT` · `DELETE /organizations/{org_id}/teams/{team_id}`

### `GET` · `POST /organizations/{org_id}/teams/{team_id}/members`

```json
{ "userId": 2, "role": "member" }
```

Adding someone to a team requires organization membership first — a team member
who is not an organization member holds no role in the owning organization, so
their access token would grant nothing.

`role` is `member` or `lead`, defaulting to `member`. The column is free text in
the specified schema rather than an enum, so it is constrained at the request
boundary rather than by a `CHECK`.

### `DELETE /organizations/{org_id}/teams/{team_id}/members/{user_id}`

## Wallets

Mounted at `/accounts/{account_id}/wallets` — under `accounts` rather than
`users` because `wallets.account_id` is polymorphic and can reference a user, an
organization, or an agent.

**Authorization.** A user account admits only its owner — not even an
administrator. An organization account admits `co_owner` and above; `admin` is
deliberately below the bar, because binding a wallet is how an organization
proves who controls it.

> All five endpoints currently answer `503 signature_unavailable`, for the reason
> given above the web3 login section.

### `POST /accounts/{account_id}/wallets/nonce`

```json
{ "chain": "ethereum", "address": "0x..." }
```

**201** returns the challenge and the message to sign. `address` is required
here, unlike the login nonce, because the message embeds it and a placeholder
would be text the client could not usefully sign.

### `POST /accounts/{account_id}/wallets/bind`

```json
{ "chain": "ethereum", "address": "0x...", "nonce": "...", "signature": "0x..." }
```

The nonce must have been issued for this account. A login challenge carries no
account and is refused, so a signature collected in one flow cannot be replayed in
the other. The first wallet on an account becomes primary.

### `GET /accounts/{account_id}/wallets`

Primary first, then oldest.

### `PUT /accounts/{account_id}/wallets/{wallet_id}/primary`

Demotes the current primary and promotes this one, in one transaction.

### `DELETE /accounts/{account_id}/wallets/{wallet_id}`

Removing the primary promotes the oldest remaining wallet. Removing the last
wallet is allowed — refusing would leave an account permanently unbindable.

## Memberships

Mounted at `/accounts/{account_id}/membership`, with the same authorization rule
as wallets.

### `GET /accounts/{account_id}/membership`

**200**

```json
{
  "membershipId": 1,
  "accountId": 1,
  "tier": "free",
  "timeStart": "2026-10-05T00:00:00.000Z",
  "timeEnd": null,
  "isExpired": false
}
```

An account with no membership row reports `free` rather than 404.

### `POST /accounts/{account_id}/membership/upgrade`

```json
{ "targetTier": "premium", "reference": "optional-idempotency-key" }
```

> **This endpoint currently answers 402 `payment_failed`.** No payment gateway is
> integrated — none was named in the specification — and the default provider
> declines every upgrade rather than reporting a fake success. Nothing is
> written. An upgrade path that silently succeeded would hand out paid tiers for
> free the first time it met a real customer.

`targetTier` is `premium` or `enterprise`. Only upgrades are supported; a
downgrade is refused rather than performed, because proration is a refund policy
this build has no answer for. Requesting the tier an account already holds is a
409, so a retried request does not become a second purchase.

The payment provider is consulted **before** the tier is written, so a declined
charge leaves the account exactly where it was.

**Note:** there is one membership row per account, updated in place. There is no
history of tier changes.