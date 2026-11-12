import { createHash } from "node:crypto";
import type { OAuthProviderConfig, ProviderCode } from "../config.js";

export type Fetch = typeof fetch;

export interface ProviderIdentity {
  /** The provider's stable numeric user id, as a string. */
  id: string;
  /** The username at the time of linking. */
  login: string;
}

export class ProviderError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ProviderError";
  }
}

interface ProviderSpec {
  display: string;
  scope: string;
  authorizeUrl(cfg: OAuthProviderConfig): string;
  tokenUrl(cfg: OAuthProviderConfig): string;
  userUrl(cfg: OAuthProviderConfig): string;
  parseUser(body: unknown): ProviderIdentity;
  /** Best-effort revocation of the access token once identity is known. */
  revoke(cfg: OAuthProviderConfig, token: string, fetchImpl: Fetch): Promise<void>;
}

const TIMEOUT_MS = 10_000;
const USER_AGENT = "lxauth-server";

function identity(id: unknown, login: unknown): ProviderIdentity {
  if ((typeof id !== "number" && typeof id !== "string") || typeof login !== "string" || login === "") {
    throw new ProviderError("invalid_profile");
  }
  return { id: String(id), login };
}

export const PROVIDERS: Record<ProviderCode, ProviderSpec> = {
  github: {
    display: "GitHub",
    scope: "read:user",
    authorizeUrl: () => "https://github.com/login/oauth/authorize",
    tokenUrl: () => "https://github.com/login/oauth/access_token",
    userUrl: () => "https://api.github.com/user",
    parseUser: (body) => {
      const b = body as { id?: unknown; login?: unknown };
      return identity(b.id, b.login);
    },
    revoke: async (cfg, token, fetchImpl) => {
      const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
      await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(cfg.clientId)}/token`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ access_token: token }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    },
  },
  gitlab: {
    display: "GitLab",
    scope: "read_user",
    authorizeUrl: (cfg) => `${cfg.baseUrl}/oauth/authorize`,
    tokenUrl: (cfg) => `${cfg.baseUrl}/oauth/token`,
    userUrl: (cfg) => `${cfg.baseUrl}/api/v4/user`,
    parseUser: (body) => {
      const b = body as { id?: unknown; username?: unknown };
      return identity(b.id, b.username);
    },
    revoke: async (cfg, token, fetchImpl) => {
      await fetchImpl(`${cfg.baseUrl}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: new URLSearchParams({ token, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    },
  },
};

export function isProviderCode(value: unknown): value is ProviderCode {
  return value === "github" || value === "gitlab";
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function callbackUrl(publicBaseUrl: string, provider: ProviderCode): string {
  return `${publicBaseUrl}/api/v1/connections/${provider}/callback`;
}

export function buildAuthorizeUrl(
  provider: ProviderCode,
  cfg: OAuthProviderConfig,
  params: { state: string; verifier: string; redirectUri: string },
): string {
  const spec = PROVIDERS[provider];
  const url = new URL(spec.authorizeUrl(cfg));
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: spec.scope,
    state: params.state,
    code_challenge: pkceChallenge(params.verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/**
 * Exchanges the authorization code, reads the user's id and login, then
 * revokes the access token. Nothing the provider returns is stored except the
 * identity.
 */
export async function fetchIdentity(
  provider: ProviderCode,
  cfg: OAuthProviderConfig,
  params: { code: string; verifier: string; redirectUri: string },
  fetchImpl: Fetch,
): Promise<ProviderIdentity> {
  const spec = PROVIDERS[provider];

  let token: string;
  try {
    const res = await fetchImpl(spec.tokenUrl(cfg), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code: params.code,
        grant_type: "authorization_code",
        redirect_uri: params.redirectUri,
        code_verifier: params.verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json()) as { access_token?: unknown };
    if (!res.ok || typeof body.access_token !== "string") throw new ProviderError("token_exchange_failed");
    token = body.access_token;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("provider_unreachable");
  }

  try {
    const res = await fetchImpl(spec.userUrl(cfg), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ProviderError("profile_fetch_failed");
    return spec.parseUser(await res.json());
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError("provider_unreachable");
  } finally {
    await spec.revoke(cfg, token, fetchImpl).catch(() => {});
  }
}
