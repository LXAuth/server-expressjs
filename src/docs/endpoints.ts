import type { Method } from "../http/route-table.js";

export type AuthKind = "client" | "session" | "owner";

export interface EndpointDoc {
  method: Method;
  path: string;
  summary: string;
  auth: AuthKind[];
  body?: object;
  response: { status: number; body?: object };
  notes?: string;
}

export interface EndpointGroup {
  id: string;
  title: string;
  intro: string;
  endpoints: EndpointDoc[];
}

const TOKEN = "lxa_…";

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    id: "accounts",
    title: "Accounts",
    intro:
      "One account works with every client. Registration needs no client, so a developer can create the account that will own their first client.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/accounts",
        summary: "Register an email account.",
        auth: [],
        body: { email: "ada@example.com", password: "at least 10 characters" },
        response: { status: 201, body: { message: "Account created" } },
        notes: "Answers 409 if the address is already registered. Limited to 10 per IP per hour.",
      },
      {
        method: "GET",
        path: "/api/v1/account/profile",
        summary: "Read your own profile.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { profile: { name_id: "ada", name_display: "Ada Lovelace", avatar_url: "https://…" } },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/account/profile",
        summary: "Set your handle, display name, or avatar. Send null to clear a field.",
        auth: ["client", "session"],
        body: { name_id: "ada", name_display: "Ada Lovelace", avatar_url: "https://example.com/ada.png" },
        response: { status: 200, body: { message: "Profile updated" } },
        notes:
          "name_id is unique, 3–50 characters of a-z, 0-9, _ or -. Organization members see it instead of your email. Answers 409 if it is taken.",
      },
      {
        method: "PUT",
        path: "/api/v1/account/password",
        summary: "Change the password. Every other session is signed out.",
        auth: ["client", "session"],
        body: { current_password: "…", new_password: "…" },
        response: { status: 200, body: { message: "Password changed; other sessions were signed out" } },
      },
      {
        method: "DELETE",
        path: "/api/v1/account",
        summary: "Delete the account and everything linked to it.",
        auth: ["client", "session"],
        body: { password: "…" },
        response: { status: 200, body: { message: "Account deleted" } },
        notes: "Answers 409 while the account owns an organization: transfer or delete it first.",
      },
    ],
  },
  {
    id: "auth",
    title: "Login and sessions",
    intro:
      "A successful login returns a message and an opaque session token, never account data. The token only works from the client that obtained it. An account can hold many sessions at once, one per device or app.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/auth/login",
        summary: "Log in with any sign-in address of the account.",
        auth: ["client"],
        body: { email: "ada@example.com", password: "…" },
        response: { status: 200, body: { message: "Login successful", session_token: TOKEN } },
        notes:
          "Every failure (unknown address, wrong password, locked or disabled account) returns the same 401 {\"message\":\"Invalid credentials\"}.",
      },
      {
        method: "GET",
        path: "/api/v1/auth/session",
        summary: "Check that a session is still valid.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Session is valid" } },
      },
      {
        method: "POST",
        path: "/api/v1/auth/logout",
        summary: "End the current session.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Logged out" } },
      },
      {
        method: "GET",
        path: "/api/v1/sessions",
        summary: "List the account's active sessions across all clients.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            sessions: [
              {
                id: "uuid",
                client_name: "My app",
                user_agent: "Mozilla/5.0 …",
                created_at: "2026-11-12T08:00:00.000Z",
                last_seen_at: "2026-11-12T08:05:00.000Z",
                expires_at: "2026-12-12T08:00:00.000Z",
                current: true,
              },
            ],
          },
        },
      },
      {
        method: "DELETE",
        path: "/api/v1/sessions",
        summary: "Sign out every session except the current one.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Signed out 2 other session(s)" } },
      },
      {
        method: "DELETE",
        path: "/api/v1/sessions/:sessionId",
        summary: "Revoke one session of the account.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Session revoked" } },
      },
    ],
  },
  {
    id: "emails",
    title: "Email addresses",
    intro:
      "An account can hold several addresses, each with a purpose: primary, recovery, notification, receipt, or other. Only addresses with login_enabled can be used to sign in, so a throwaway receipt address never becomes a way in.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/account/emails",
        summary: "List the account's addresses.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            emails: [
              {
                id: "uuid",
                email: "ada@example.com",
                type: "primary",
                login_enabled: true,
                verified: false,
                created_at: "…",
                updated_at: "…",
              },
            ],
          },
        },
      },
      {
        method: "POST",
        path: "/api/v1/account/emails",
        summary: "Add an address with a purpose.",
        auth: ["client", "session"],
        body: { email: "shop@example.com", type: "receipt", login_enabled: false },
        response: { status: 201, body: { message: "Email added", id: "uuid" } },
      },
      {
        method: "PATCH",
        path: "/api/v1/account/emails/:emailId",
        summary: "Change an address's purpose or sign-in flag.",
        auth: ["client", "session"],
        body: { type: "primary" },
        response: { status: 200, body: { message: "Email updated" } },
        notes: "Promoting an address to primary turns the previous primary into \"other\" (still a sign-in address).",
      },
      {
        method: "DELETE",
        path: "/api/v1/account/emails/:emailId",
        summary: "Remove an address. The primary address cannot be removed.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Email removed" } },
      },
    ],
  },
  {
    id: "organizations",
    title: "Organizations",
    intro:
      "Accounts can belong to organizations with one of five roles, strongest first: owner, co_owner, admin, member, guest. Every organization has exactly one owner. Members see each other by profile (name_id, display name), never by email. A non-member gets 404 for an organization, so its existence is not revealed.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/organizations/:orgId/access",
        summary: "Zero-trust check: does the current user hold at least this role?",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Access granted" } },
        notes:
          "Pass ?role=owner|co_owner|admin|member|guest (default guest, meaning any membership). Otherwise 403 {\"message\":\"Access denied\"}, including when the organization does not exist.",
      },
      {
        method: "POST",
        path: "/api/v1/organizations",
        summary: "Create an organization. You become its owner.",
        auth: ["client", "session"],
        body: { slug: "acme", name: "Acme Inc." },
        response: { status: 201, body: { message: "Organization created", id: "uuid" } },
      },
      {
        method: "GET",
        path: "/api/v1/organizations",
        summary: "List the organizations you belong to, with your role in each.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { organizations: [{ id: "uuid", slug: "acme", name: "Acme Inc.", role: "owner", created_at: "…" }] },
        },
      },
      {
        method: "GET",
        path: "/api/v1/organizations/:orgId",
        summary: "Read one organization you belong to.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { organization: { id: "uuid", slug: "acme", name: "Acme Inc.", role: "admin", created_at: "…" } },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/organizations/:orgId",
        summary: "Rename an organization or change its slug. Admin or above.",
        auth: ["client", "session"],
        body: { name: "Acme Corporation" },
        response: { status: 200, body: { message: "Organization updated" } },
      },
      {
        method: "DELETE",
        path: "/api/v1/organizations/:orgId",
        summary: "Delete an organization, its teams, and its invites. Owner only.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Organization deleted" } },
      },
      {
        method: "GET",
        path: "/api/v1/organizations/:orgId/members",
        summary: "List members by profile and role. Member or above.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            members: [
              { account_id: "uuid", name_id: "ada", name_display: "Ada", avatar_url: null, role: "owner", joined_at: "…" },
            ],
          },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/organizations/:orgId/members/:accountId",
        summary: "Change a member's role.",
        auth: ["client", "session"],
        body: { role: "admin" },
        response: { status: 200, body: { message: "Role updated" } },
        notes:
          "Admin or above, and you must outrank both the member's current role and the new one. The owner can also appoint co-owners. Ownership moves only through the transfer endpoint.",
      },
      {
        method: "DELETE",
        path: "/api/v1/organizations/:orgId/members/:accountId",
        summary: "Remove a member, or leave by passing your own account id.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Member removed" } },
        notes: "Admins and above can remove lower roles. The owner cannot leave without transferring ownership.",
      },
      {
        method: "POST",
        path: "/api/v1/organizations/:orgId/transfer",
        summary: "Hand ownership to another member. You become a co-owner.",
        auth: ["client", "session"],
        body: { account_id: "uuid" },
        response: { status: 200, body: { message: "Ownership transferred" } },
      },
      {
        method: "POST",
        path: "/api/v1/organizations/:orgId/invites",
        summary: "Create a single-use invite. The token is shown once.",
        auth: ["client", "session"],
        body: { role: "member", email: "new@example.com", expires_in_hours: 168 },
        response: {
          status: 201,
          body: {
            message: "Invite created; share the token now, it is not shown again",
            id: "uuid",
            invite_token: "lxi_…",
            expires_at: "…",
          },
        },
        notes:
          "Admin or above, for a role below your own (the owner may invite co-owners). With email set, only an account holding that address can accept. Default expiry 7 days, maximum 30.",
      },
      {
        method: "GET",
        path: "/api/v1/organizations/:orgId/invites",
        summary: "List pending invites. Admin or above.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { invites: [{ id: "uuid", role: "member", email: null, expires_at: "…", created_at: "…" }] },
        },
      },
      {
        method: "DELETE",
        path: "/api/v1/organizations/:orgId/invites/:inviteId",
        summary: "Revoke a pending invite. Admin or above.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Invite revoked" } },
      },
      {
        method: "POST",
        path: "/api/v1/invites/accept",
        summary: "Join an organization with an invite token.",
        auth: ["client", "session"],
        body: { invite_token: "lxi_…" },
        response: { status: 200, body: { message: "Joined the organization" } },
        notes: "Unknown, expired, used, or wrong-address invites all answer 400 Invalid or expired invite.",
      },
    ],
  },
  {
    id: "teams",
    title: "Teams",
    intro:
      "Teams group members of one organization, with two roles: lead and member. Organization owners, co-owners, and admins manage every team; a lead manages the plain members of their own team. Leaving or being removed from the organization also removes you from its teams. Guests only see the teams they are on.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/teams/:teamId/access",
        summary: "Zero-trust check: is the current user on this team, with at least this role?",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Access granted" } },
        notes:
          "Pass ?role=lead|member (default member). Organization owners, co-owners, and admins always pass. Otherwise 403 {\"message\":\"Access denied\"}, including for a team that does not exist.",
      },
      {
        method: "POST",
        path: "/api/v1/organizations/:orgId/teams",
        summary: "Create a team. Organization admin or above.",
        auth: ["client", "session"],
        body: { name: "Platform", description: "Runs the shared services" },
        response: { status: 201, body: { message: "Team created", id: "uuid" } },
      },
      {
        method: "GET",
        path: "/api/v1/organizations/:orgId/teams",
        summary: "List an organization's teams, with your role in each (null if you are not on it).",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            teams: [
              { id: "uuid", organization_id: "uuid", name: "Platform", description: null, role: "lead", created_at: "…" },
            ],
          },
        },
      },
      {
        method: "GET",
        path: "/api/v1/teams/:teamId",
        summary: "Read one team.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { team: { id: "uuid", organization_id: "uuid", name: "Platform", description: null, role: null, created_at: "…" } },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/teams/:teamId",
        summary: "Rename a team or change its description. Organization admin or team lead.",
        auth: ["client", "session"],
        body: { description: "Owns CI and the API gateway" },
        response: { status: 200, body: { message: "Team updated" } },
      },
      {
        method: "DELETE",
        path: "/api/v1/teams/:teamId",
        summary: "Delete a team. Organization admin or above.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Team deleted" } },
      },
      {
        method: "GET",
        path: "/api/v1/teams/:teamId/members",
        summary: "List team members by profile and role.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            members: [{ account_id: "uuid", name_id: "ada", name_display: "Ada", avatar_url: null, role: "lead", joined_at: "…" }],
          },
        },
      },
      {
        method: "PUT",
        path: "/api/v1/teams/:teamId/members/:accountId",
        summary: "Add an organization member to the team, or change their team role.",
        auth: ["client", "session"],
        body: { role: "member" },
        response: { status: 201, body: { message: "Member added" } },
        notes: "201 when added, 200 when the role changed. Leads can add and manage plain members only; organization admins can set leads.",
      },
      {
        method: "DELETE",
        path: "/api/v1/teams/:teamId/members/:accountId",
        summary: "Remove someone from the team, or leave it with your own account id.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Member removed" } },
      },
    ],
  },
  {
    id: "connections",
    title: "GitHub and GitLab",
    intro:
      "Link a GitHub or GitLab identity to an email account. Only the provider's user id and username are kept; the provider token is revoked straight after use. When a provider is not configured on this server, it is listed with enabled: false and linking answers 404.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/connections",
        summary: "List providers and which are linked.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: {
            connections: [
              { provider: "github", display: "GitHub", enabled: true, linked: true, login: "ada", linked_at: "…" },
            ],
          },
        },
      },
      {
        method: "POST",
        path: "/api/v1/connections/:provider",
        summary: "Start linking. Send the user's browser to authorize_url.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { message: "Send the user to authorize_url", authorize_url: "https://github.com/login/oauth/authorize?…" },
        },
        notes: "The client must have a redirect_uri: that is where the user returns, with ?provider=…&status=linked|denied|error&reason=….",
      },
      {
        method: "GET",
        path: "/api/v1/connections/:provider/callback",
        summary: "Where GitHub or GitLab sends the browser back. Register this URL with the provider.",
        auth: [],
        response: { status: 303 },
      },
      {
        method: "DELETE",
        path: "/api/v1/connections/:provider",
        summary: "Unlink a provider.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Provider unlinked" } },
      },
    ],
  },
  {
    id: "wallets",
    title: "Ethereum wallets",
    intro:
      "Link Ethereum wallets to an account and sign in with them using Sign-In with Ethereum (EIP-4361). The server writes the exact message to sign and accepts each one once, from the same client, within 10 minutes. Wallet sign-in needs the client's siwe_domain set; the message names that domain.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/auth/wallet/challenge",
        summary: "Get the sign-in message for a wallet address.",
        auth: ["client"],
        body: { address: "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23", chain_id: 1 },
        response: {
          status: 200,
          body: {
            message: "Sign siwe_message with the wallet (personal_sign)",
            siwe_message: "app.example.com wants you to sign in with your Ethereum account:\n0x2c75…",
            expires_at: "…",
          },
        },
        notes: "Issued for any address, linked or not, so it reveals nothing about which wallets exist.",
      },
      {
        method: "POST",
        path: "/api/v1/auth/wallet/login",
        summary: "Sign in with the signed message.",
        auth: ["client"],
        body: { message: "<siwe_message, unchanged>", signature: "0x…(65 bytes)" },
        response: { status: 200, body: { message: "Login successful", session_token: "lxa_…" } },
        notes: "Every failure answers the same 401 {\"message\":\"Invalid credentials\"}.",
      },
      {
        method: "GET",
        path: "/api/v1/account/wallets",
        summary: "List linked wallets.",
        auth: ["client", "session"],
        response: {
          status: 200,
          body: { wallets: [{ id: "uuid", address: "0x2c75…", chain_id: 1, created_at: "…", last_used_at: null }] },
        },
      },
      {
        method: "POST",
        path: "/api/v1/account/wallets/challenge",
        summary: "Get the message that proves you control a wallet you want to link.",
        auth: ["client", "session"],
        body: { address: "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23", chain_id: 1 },
        response: {
          status: 200,
          body: { message: "Sign siwe_message with the wallet (personal_sign)", siwe_message: "…", expires_at: "…" },
        },
      },
      {
        method: "POST",
        path: "/api/v1/account/wallets",
        summary: "Link the wallet with the signed message.",
        auth: ["client", "session"],
        body: { message: "<siwe_message, unchanged>", signature: "0x…" },
        response: { status: 201, body: { message: "Wallet linked", id: "uuid" } },
        notes: "A wallet can be linked to one account only (409 otherwise).",
      },
      {
        method: "DELETE",
        path: "/api/v1/account/wallets/:walletId",
        summary: "Unlink a wallet.",
        auth: ["client", "session"],
        response: { status: 200, body: { message: "Wallet unlinked" } },
      },
    ],
  },
  {
    id: "clients",
    title: "Clients",
    intro:
      "A client is an application that uses this server for login. Manage your clients with your own email and password (HTTP Basic). Keep the client secret on your backend: it must never ship to a browser or mobile app.",
    endpoints: [
      {
        method: "POST",
        path: "/api/v1/clients",
        summary: "Register a client. The secret is shown once.",
        auth: ["owner"],
        body: { name: "My app", redirect_uri: "https://app.example.com/after-link", siwe_domain: "app.example.com" },
        response: {
          status: 201,
          body: {
            message: "Client created; store the secret now, it is not shown again",
            client_id: "lxc_…",
            client_secret: "lxs_…",
          },
        },
      },
      {
        method: "GET",
        path: "/api/v1/clients",
        summary: "List your clients.",
        auth: ["owner"],
        response: {
          status: 200,
          body: {
            clients: [
              {
                client_id: "lxc_…",
                name: "My app",
                redirect_uri: "https://…",
                siwe_domain: "app.example.com",
                created_at: "…",
                updated_at: "…",
              },
            ],
          },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/clients/:clientId",
        summary: "Rename a client or change its redirect URI or wallet sign-in domain.",
        auth: ["owner"],
        body: { name: "Renamed app", redirect_uri: null },
        response: { status: 200, body: { message: "Client updated" } },
      },
      {
        method: "POST",
        path: "/api/v1/clients/:clientId/secret",
        summary: "Rotate the client secret. The old secret stops working at once.",
        auth: ["owner"],
        response: {
          status: 200,
          body: { message: "Secret rotated; store it now, it is not shown again", client_id: "lxc_…", client_secret: "lxs_…" },
        },
      },
      {
        method: "DELETE",
        path: "/api/v1/clients/:clientId",
        summary: "Revoke a client and every session it created.",
        auth: ["owner"],
        response: { status: 200, body: { message: "Client revoked" } },
      },
    ],
  },
  {
    id: "service",
    title: "Service",
    intro: "Health and this page.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/health",
        summary: "Liveness and database check.",
        auth: [],
        response: { status: 200, body: { message: "OK" } },
      },
      {
        method: "GET",
        path: "/api",
        summary: "This page.",
        auth: [],
        response: { status: 200 },
      },
    ],
  },
];
