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
        body: { name: "My app", redirect_uri: "https://app.example.com/after-link" },
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
          body: { clients: [{ client_id: "lxc_…", name: "My app", redirect_uri: "https://…", created_at: "…", updated_at: "…" }] },
        },
      },
      {
        method: "PATCH",
        path: "/api/v1/clients/:clientId",
        summary: "Rename a client or change its redirect URI.",
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
