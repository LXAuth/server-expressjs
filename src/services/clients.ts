import { transaction, type Db } from "../db/pool.js";
import { notFound } from "../http/errors.js";
import { randomToken, safeEqualHex, sha256Hex } from "../security/crypto.js";
import { audit } from "./audit.js";

export interface AuthenticatedClient {
  id: string;
  publicId: string;
  redirectUri: string | null;
}

export interface ClientSummary {
  client_id: string;
  name: string;
  redirect_uri: string | null;
  siwe_domain: string | null;
  created_at: Date;
  updated_at: Date;
}

const CLIENT_ID_PATTERN = /^lxc_[A-Za-z0-9_-]{22}$/;

/** Checks a client id and secret. Unknown, revoked, and wrong-secret all return `null`. */
export async function authenticateClient(
  db: Db,
  publicId: string,
  secret: string,
): Promise<AuthenticatedClient | null> {
  if (!CLIENT_ID_PATTERN.test(publicId) || secret.length > 128) return null;
  const { rows } = await db.query<{ id: string; secret_hash: string; redirect_uri: string | null }>(
    "SELECT id, secret_hash, redirect_uri FROM clients WHERE public_id = $1 AND revoked_at IS NULL",
    [publicId],
  );
  const row = rows[0];
  // Hash even when the client is unknown so both paths cost the same.
  const presented = sha256Hex(secret);
  if (!row || !safeEqualHex(presented, row.secret_hash)) return null;
  return { id: row.id, publicId, redirectUri: row.redirect_uri };
}

export async function createClient(
  db: Db,
  ownerAccountId: string,
  input: { name: string; redirect_uri?: string | null | undefined; siwe_domain?: string | null | undefined },
  ip?: string,
): Promise<{ client_id: string; client_secret: string }> {
  const publicId = randomToken("lxc", 16);
  const secret = randomToken("lxs");
  await transaction(db, async (tx) => {
    const {
      rows: [client],
    } = await tx.query<{ id: string }>(
      `INSERT INTO clients (owner_account_id, public_id, secret_hash, name, redirect_uri, siwe_domain)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ownerAccountId, publicId, sha256Hex(secret), input.name, input.redirect_uri ?? null, input.siwe_domain ?? null],
    );
    await audit(tx, "client.created", { accountId: ownerAccountId, clientId: client?.id ?? null, ip });
  });
  return { client_id: publicId, client_secret: secret };
}

export async function listClients(db: Db, ownerAccountId: string): Promise<ClientSummary[]> {
  const { rows } = await db.query<ClientSummary>(
    `SELECT public_id AS client_id, name, redirect_uri, siwe_domain, created_at, updated_at
       FROM clients WHERE owner_account_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [ownerAccountId],
  );
  return rows;
}

async function ownedClientId(db: Db, ownerAccountId: string, publicId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM clients WHERE public_id = $1 AND owner_account_id = $2 AND revoked_at IS NULL",
    [publicId, ownerAccountId],
  );
  if (!rows[0]) throw notFound();
  return rows[0].id;
}

export async function updateClient(
  db: Db,
  ownerAccountId: string,
  publicId: string,
  input: {
    name?: string | undefined;
    redirect_uri?: string | null | undefined;
    siwe_domain?: string | null | undefined;
  },
  ip?: string,
): Promise<void> {
  const id = await ownedClientId(db, ownerAccountId, publicId);
  await db.query(
    `UPDATE clients
        SET name = COALESCE($2, name),
            redirect_uri = CASE WHEN $3::boolean THEN $4 ELSE redirect_uri END,
            siwe_domain = CASE WHEN $5::boolean THEN $6 ELSE siwe_domain END
      WHERE id = $1`,
    [
      id,
      input.name ?? null,
      input.redirect_uri !== undefined,
      input.redirect_uri ?? null,
      input.siwe_domain !== undefined,
      input.siwe_domain ?? null,
    ],
  );
  await audit(db, "client.updated", { accountId: ownerAccountId, clientId: id, ip });
}

/** Issues a new secret. The old one stops working immediately; sessions are kept. */
export async function rotateClientSecret(
  db: Db,
  ownerAccountId: string,
  publicId: string,
  ip?: string,
): Promise<{ client_id: string; client_secret: string }> {
  const id = await ownedClientId(db, ownerAccountId, publicId);
  const secret = randomToken("lxs");
  await db.query("UPDATE clients SET secret_hash = $2 WHERE id = $1", [id, sha256Hex(secret)]);
  await audit(db, "client.secret_rotated", { accountId: ownerAccountId, clientId: id, ip });
  return { client_id: publicId, client_secret: secret };
}

/** Revokes a client and every session it created. */
export async function revokeClient(db: Db, ownerAccountId: string, publicId: string, ip?: string): Promise<void> {
  const id = await ownedClientId(db, ownerAccountId, publicId);
  await transaction(db, async (tx) => {
    await tx.query("UPDATE clients SET revoked_at = now() WHERE id = $1", [id]);
    await tx.query("UPDATE sessions SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL", [id]);
    await audit(tx, "client.revoked", { accountId: ownerAccountId, clientId: id, ip });
  });
}
