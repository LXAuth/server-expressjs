# 0.2.0 — 2026-11-12

Profiles, organizations, teams, and Ethereum wallets, ported from the unmerged
2026-10-05 work and rebuilt on the 0.1.0 zero-trust design.

Readers need do nothing to keep 0.1.0 behaviour: every 0.1.0 endpoint and response is
unchanged. Run the server once (or `npm run migrate`) to apply migrations 0002–0005.

## Added

- Profiles: `GET`/`PATCH /api/v1/account/profile` with a unique `name_id` handle, a display
  name, and an https avatar URL.
- Organizations with five ranked roles (`owner`, `co_owner`, `admin`, `member`, `guest`),
  member management by rank, leaving, ownership transfer, and single-use invite tokens that
  can be restricted to one email address.
- Teams inside organizations with `lead` and `member` roles; leaving an organization removes
  its team memberships.
- Zero-trust access checks for client apps:
  `GET /api/v1/organizations/{id}/access?role=` and `GET /api/v1/teams/{id}/access?role=`
  answer only `200 Access granted` or `403 Access denied`.
- Ethereum wallets: link, list, and unlink with Sign-In with Ethereum (EIP-4361), and sign
  in with a linked wallet through `/api/v1/auth/wallet/challenge` and `/login`.
- `clients.siwe_domain`, settable when creating or updating a client.
- Schema: `account_property.name_id/name_display/avatar_url`, `organizations`,
  `organization_members`, `organization_invites`, `teams`, `team_members`, `wallets`,
  `wallet_challenges`, and the `ethereum` platform.

## Changed

- `DELETE /api/v1/account` answers `409` while the account owns an organization.
- `GET /api/v1/clients` includes `siwe_domain`.

## Security

- Exactly one owner per organization is enforced by a partial unique index, not only by
  application logic.
- Invite tokens and wallet challenges are stored only as SHA-256 hashes and are single use.
- Wallet signatures are verified with the audited `@noble/curves` and `@noble/hashes`;
  high-S (malleable) signatures are rejected. The server writes every message it accepts.
- Dependency audit at release: no known vulnerabilities (see [NOTES.md](NOTES.md)).

## Not ported from the 2026-10-05 work

JWT access/refresh tokens and `verify-token` (they carry user data, against the zero-trust
design), membership tiers (no payment provider), postal addresses, and email verification
(no mail service).
