import type { Config } from "../config.js";
import { transaction, type Db } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { sha256Hex } from "../security/crypto.js";
import { buildSiweMessage, recoverAddress, siweNonce } from "../web3/siwe.js";
import { audit } from "./audit.js";
import type { AuthenticatedClient } from "./clients.js";
import { createSession, type SessionContext } from "./sessions.js";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type ChallengePurpose = "login" | "link";

const STATEMENT: Record<ChallengePurpose, string> = {
  login: "Sign in with your Ethereum wallet. This request will not trigger a blockchain transaction or cost any gas.",
  link: "Link this Ethereum wallet to your account. This request will not trigger a blockchain transaction or cost any gas.",
};

async function clientSiwe(db: Db, client: AuthenticatedClient): Promise<{ domain: string; uri: string }> {
  const { rows } = await db.query<{ siwe_domain: string | null; redirect_uri: string | null }>(
    "SELECT siwe_domain, redirect_uri FROM clients WHERE id = $1",
    [client.id],
  );
  const domain = rows[0]?.siwe_domain;
  if (!domain) throw new HttpError(400, "This client has no siwe_domain for wallet sign-in");
  const redirect = rows[0]?.redirect_uri;
  const uri = redirect && new URL(redirect).host === domain ? new URL(redirect).origin : `https://${domain}`;
  return { domain, uri };
}

/**
 * Issues the exact message the wallet must sign. Only its hash is stored, and
 * it can be used once, by the same client, before it expires. A login
 * challenge is issued whether or not the address is linked, so the answer
 * reveals nothing about which wallets exist.
 */
export async function issueChallenge(
  db: Db,
  client: AuthenticatedClient,
  input: { address: string; chain_id: number; purpose: ChallengePurpose; sessionId?: string },
): Promise<{ message: string; expires_at: Date }> {
  const { domain, uri } = await clientSiwe(db, client);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const address = input.address.toLowerCase();
  const message = buildSiweMessage({
    domain,
    address,
    statement: STATEMENT[input.purpose],
    uri,
    chainId: input.chain_id,
    nonce: siweNonce(),
    issuedAt,
    expiresAt,
  });

  await db.query("DELETE FROM wallet_challenges WHERE expires_at < now()");
  await db.query(
    `INSERT INTO wallet_challenges (message_hash, purpose, client_id, session_id, address, chain_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256Hex(message), input.purpose, client.id, input.sessionId ?? null, address, input.chain_id, expiresAt],
  );
  return { message, expires_at: expiresAt };
}

/** Consumes a challenge and checks the signature. Returns the address and chain, or `null`. */
async function consumeChallenge(
  db: Db,
  message: string,
  signature: string,
  expect: { purpose: ChallengePurpose; clientId: string; sessionId?: string },
): Promise<{ address: string; chainId: number } | null> {
  if (message.length > 2048) return null;
  const { rows } = await db.query<{ address: string; chain_id: number; session_id: string | null }>(
    `UPDATE wallet_challenges SET consumed_at = now()
      WHERE message_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        AND purpose = $2 AND client_id = $3
  RETURNING address, chain_id, session_id`,
    [sha256Hex(message), expect.purpose, expect.clientId],
  );
  const row = rows[0];
  if (!row) return null;
  if (expect.purpose === "link" && row.session_id !== expect.sessionId) return null;
  const signer = recoverAddress(message, signature);
  if (signer !== row.address) return null;
  return { address: row.address, chainId: row.chain_id };
}

/** Signs in with a linked wallet. Every failure is the same `null`. */
export async function walletLogin(
  db: Db,
  config: Config,
  client: AuthenticatedClient,
  input: { message: string; signature: string },
  meta: { userAgent?: string | undefined; ip?: string | undefined },
): Promise<string | null> {
  const verified = await consumeChallenge(db, input.message, input.signature, {
    purpose: "login",
    clientId: client.id,
  });
  if (!verified) {
    await audit(db, "wallet.login_failed", { clientId: client.id, ip: meta.ip });
    return null;
  }
  const { rows } = await db.query<{ account_id: string }>(
    `UPDATE wallets w SET last_used_at = now()
       FROM accounts a
      WHERE w.address = $1 AND a.id = w.account_id AND a.status = 'active'
  RETURNING w.account_id`,
    [verified.address],
  );
  const accountId = rows[0]?.account_id;
  if (!accountId) {
    await audit(db, "wallet.login_failed", { clientId: client.id, ip: meta.ip });
    return null;
  }
  return createSession(db, config, accountId, client.id, meta);
}

export async function linkWallet(
  db: Db,
  session: SessionContext,
  input: { message: string; signature: string },
  ip?: string,
): Promise<string> {
  const verified = await consumeChallenge(db, input.message, input.signature, {
    purpose: "link",
    clientId: session.clientId,
    sessionId: session.sessionId,
  });
  if (!verified) throw new HttpError(400, "Invalid signature or challenge");
  try {
    return await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO wallets (account_id, address, chain_id) VALUES ($1, $2, $3) RETURNING id",
        [session.accountId, verified.address, verified.chainId],
      );
      await audit(tx, "wallet.linked", { accountId: session.accountId, clientId: session.clientId, ip });
      return rows[0]!.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, "This wallet is already linked");
    throw err;
  }
}

export interface WalletSummary {
  id: string;
  address: string;
  chain_id: number;
  created_at: Date;
  last_used_at: Date | null;
}

export async function listWallets(db: Db, accountId: string): Promise<WalletSummary[]> {
  const { rows } = await db.query<WalletSummary>(
    "SELECT id, address, chain_id, created_at, last_used_at FROM wallets WHERE account_id = $1 ORDER BY created_at",
    [accountId],
  );
  return rows;
}

export async function unlinkWallet(db: Db, session: SessionContext, walletId: string, ip?: string): Promise<void> {
  const { rowCount } = await db.query("DELETE FROM wallets WHERE id = $1 AND account_id = $2", [
    walletId,
    session.accountId,
  ]);
  if (!rowCount) throw notFound();
  await audit(db, "wallet.unlinked", { accountId: session.accountId, clientId: session.clientId, ip });
}
