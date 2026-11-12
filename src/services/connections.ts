import type { Config, ProviderCode } from "../config.js";
import { transaction, type Db } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { buildAuthorizeUrl, callbackUrl, fetchIdentity, PROVIDERS, ProviderError, type Fetch } from "../oauth/providers.js";
import { randomToken, sha256Hex } from "../security/crypto.js";
import { audit } from "./audit.js";
import type { SessionContext } from "./sessions.js";

const STATE_TTL_MINUTES = 10;

export interface ConnectionSummary {
  provider: ProviderCode;
  display: string;
  enabled: boolean;
  linked: boolean;
  login: string | null;
  linked_at: Date | null;
}

export async function listConnections(db: Db, config: Config, accountId: string): Promise<ConnectionSummary[]> {
  const { rows } = await db.query<{ code_system: ProviderCode; provider_login: string; created_at: Date }>(
    `SELECT p.code_system, c.provider_login, c.created_at
       FROM account_connections c JOIN platforms p ON p.id = c.platform_id
      WHERE c.account_id = $1`,
    [accountId],
  );
  const linked = new Map(rows.map((r) => [r.code_system, r]));
  return (Object.keys(PROVIDERS) as ProviderCode[]).map((provider) => {
    const row = linked.get(provider);
    return {
      provider,
      display: PROVIDERS[provider].display,
      enabled: config.providers[provider] !== undefined,
      linked: row !== undefined,
      login: row?.provider_login ?? null,
      linked_at: row?.created_at ?? null,
    };
  });
}

function providerConfig(config: Config, provider: ProviderCode) {
  const cfg = config.providers[provider];
  if (!cfg) throw new HttpError(404, "Provider is not configured on this server");
  return cfg;
}

/** Starts linking: stores single-use state and returns the provider URL to send the user to. */
export async function startLink(
  db: Db,
  config: Config,
  provider: ProviderCode,
  session: SessionContext,
  clientRedirectUri: string | null,
): Promise<string> {
  const cfg = providerConfig(config, provider);
  if (!clientRedirectUri) {
    throw new HttpError(400, "This client has no redirect_uri to return the user to");
  }
  const { rowCount } = await db.query(
    `SELECT 1 FROM account_connections c JOIN platforms p ON p.id = c.platform_id
      WHERE c.account_id = $1 AND p.code_system = $2`,
    [session.accountId, provider],
  );
  if (rowCount) throw new HttpError(409, "This provider is already linked");

  const state = randomToken("lxo");
  const verifier = randomToken("v").slice(2); // 43 base64url chars, valid PKCE verifier
  await db.query("DELETE FROM oauth_states WHERE expires_at < now()");
  await db.query(
    `INSERT INTO oauth_states (state_hash, session_id, platform_id, code_verifier, expires_at)
     SELECT $1, $2, id, $3, now() + make_interval(mins => $5) FROM platforms WHERE code_system = $4`,
    [sha256Hex(state), session.sessionId, verifier, provider, STATE_TTL_MINUTES],
  );
  return buildAuthorizeUrl(provider, cfg, {
    state,
    verifier,
    redirectUri: callbackUrl(config.publicBaseUrl, provider),
  });
}

export interface CallbackResult {
  /** Where to send the browser; `null` when the state was unknown, so there is nowhere safe to go. */
  redirectTo: string | null;
}

function withStatus(base: string, provider: ProviderCode, status: string, reason?: string): string {
  const url = new URL(base);
  url.searchParams.set("provider", provider);
  url.searchParams.set("status", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

/**
 * Finishes linking. The state is consumed whether or not linking succeeds, and
 * the browser goes back to the redirect URI of the client that started it.
 */
export async function finishLink(
  db: Db,
  config: Config,
  provider: ProviderCode,
  query: { state?: unknown; code?: unknown; error?: unknown },
  fetchImpl: Fetch,
  ip?: string,
): Promise<CallbackResult> {
  if (typeof query.state !== "string" || query.state.length > 128) return { redirectTo: null };

  const { rows } = await db.query<{
    session_id: string;
    account_id: string;
    client_id: string;
    code_verifier: string;
    redirect_uri: string | null;
  }>(
    `DELETE FROM oauth_states o
      USING sessions s, clients c, platforms p
      WHERE o.state_hash = $1 AND o.expires_at > now()
        AND s.id = o.session_id AND s.revoked_at IS NULL AND s.expires_at > now()
        AND c.id = s.client_id AND c.revoked_at IS NULL
        AND p.id = o.platform_id AND p.code_system = $2
  RETURNING o.session_id, s.account_id, s.client_id, o.code_verifier, c.redirect_uri`,
    [sha256Hex(query.state), provider],
  );
  const row = rows[0];
  if (!row?.redirect_uri) return { redirectTo: null };
  const back = row.redirect_uri;

  if (query.error !== undefined) return { redirectTo: withStatus(back, provider, "denied") };
  if (typeof query.code !== "string" || query.code.length === 0 || query.code.length > 512) {
    return { redirectTo: withStatus(back, provider, "error", "missing_code") };
  }
  const cfg = config.providers[provider];
  if (!cfg) return { redirectTo: withStatus(back, provider, "error", "provider_disabled") };

  let who;
  try {
    who = await fetchIdentity(
      provider,
      cfg,
      { code: query.code, verifier: row.code_verifier, redirectUri: callbackUrl(config.publicBaseUrl, provider) },
      fetchImpl,
    );
  } catch (err) {
    const reason = err instanceof ProviderError ? err.reason : "provider_error";
    return { redirectTo: withStatus(back, provider, "error", reason) };
  }

  try {
    await transaction(db, async (tx) => {
      await tx.query(
        `INSERT INTO account_connections (account_id, platform_id, provider_user_id, provider_login)
         SELECT $1, id, $3, $4 FROM platforms WHERE code_system = $2`,
        [row.account_id, provider, who.id, who.login.slice(0, 255)],
      );
      await audit(tx, "connection.linked", { accountId: row.account_id, clientId: row.client_id, ip });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return { redirectTo: withStatus(back, provider, "error", "already_linked") };
    }
    throw err;
  }
  return { redirectTo: withStatus(back, provider, "linked") };
}

export async function unlink(db: Db, provider: ProviderCode, session: SessionContext, ip?: string): Promise<void> {
  const { rowCount } = await db.query(
    `DELETE FROM account_connections c USING platforms p
      WHERE p.id = c.platform_id AND c.account_id = $1 AND p.code_system = $2`,
    [session.accountId, provider],
  );
  if (!rowCount) throw notFound();
  await audit(db, "connection.unlinked", { accountId: session.accountId, clientId: session.clientId, ip });
}
