import type { Config } from "../config.js";
import { transaction, type Db } from "../db/pool.js";
import { notFound } from "../http/errors.js";
import { randomToken, sha256Hex } from "../security/crypto.js";
import { audit } from "./audit.js";

export interface SessionContext {
  sessionId: string;
  accountId: string;
  clientId: string;
}

export const SESSION_TOKEN_PREFIX = "lxa";

/**
 * Opens a new session and returns its token. The token is shown to the
 * caller once; only its hash is stored. When the account already holds the
 * maximum number of sessions, the least recently used one is revoked.
 */
export async function createSession(
  db: Db,
  config: Config,
  accountId: string,
  clientId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined },
): Promise<string> {
  const token = randomToken(SESSION_TOKEN_PREFIX);
  await transaction(db, async (tx) => {
    // Serialise logins for one account so the session cap cannot be raced past.
    await tx.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
    await tx.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id IN (
          SELECT id FROM sessions
           WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
           ORDER BY last_seen_at DESC
          OFFSET $2::int - 1
        )`,
      [accountId, config.maxSessionsPerAccount],
    );
    await tx.query(
      `INSERT INTO sessions (account_id, client_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
      [
        accountId,
        clientId,
        sha256Hex(token),
        meta.userAgent?.slice(0, 512) ?? null,
        meta.ip ?? null,
        config.sessionTtlHours,
      ],
    );
    await audit(tx, "login.succeeded", { accountId, clientId, ip: meta.ip });
  });
  return token;
}

/**
 * Resolves a bearer token to a live session, but only for the client that
 * created it: a token replayed from another client is treated as unknown.
 */
export async function resolveSession(db: Db, token: string, clientId: string): Promise<SessionContext | null> {
  if (!token.startsWith(`${SESSION_TOKEN_PREFIX}_`) || token.length > 128) return null;
  const { rows } = await db.query<{ id: string; account_id: string; stale: boolean }>(
    `SELECT s.id, s.account_id, s.last_seen_at < now() - interval '1 minute' AS stale
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.client_id = $2
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND a.status = 'active'`,
    [sha256Hex(token), clientId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.id]);
  }
  return { sessionId: row.id, accountId: row.account_id, clientId };
}

export interface SessionSummary {
  id: string;
  client_name: string;
  user_agent: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  current: boolean;
}

export async function listSessions(db: Db, session: SessionContext): Promise<SessionSummary[]> {
  const { rows } = await db.query<SessionSummary>(
    `SELECT s.id, c.name AS client_name, s.user_agent, s.created_at, s.last_seen_at, s.expires_at,
            s.id = $2 AS current
       FROM sessions s
       JOIN clients c ON c.id = s.client_id
      WHERE s.account_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
      ORDER BY s.last_seen_at DESC`,
    [session.accountId, session.sessionId],
  );
  return rows;
}

export async function revokeSession(db: Db, session: SessionContext, sessionId: string, ip?: string): Promise<void> {
  const { rowCount } = await db.query(
    "UPDATE sessions SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL",
    [sessionId, session.accountId],
  );
  if (rowCount === 0) throw notFound();
  await audit(db, "session.revoked", { accountId: session.accountId, clientId: session.clientId, ip });
}

/** Revokes every session of the account except the one making the request. */
export async function revokeOtherSessions(db: Db, session: SessionContext, ip?: string): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL",
    [session.accountId, session.sessionId],
  );
  if ((rowCount ?? 0) > 0) {
    await audit(db, "session.revoked", { accountId: session.accountId, clientId: session.clientId, ip });
  }
  return rowCount ?? 0;
}
