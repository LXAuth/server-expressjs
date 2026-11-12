import { transaction, type Db } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { audit } from "./audit.js";

export interface EmailSummary {
  id: string;
  email: string;
  type: string;
  login_enabled: boolean;
  verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listEmails(db: Db, accountId: string): Promise<EmailSummary[]> {
  const { rows } = await db.query<EmailSummary>(
    `SELECT id, email, type, login_enabled, verified_at IS NOT NULL AS verified, created_at, updated_at
       FROM account_emails WHERE account_id = $1
      ORDER BY (type = 'primary') DESC, created_at`,
    [accountId],
  );
  return rows;
}

export async function addEmail(
  db: Db,
  accountId: string,
  input: { email: string; type: string; login_enabled: boolean },
  ip?: string,
): Promise<string> {
  if (input.type === "primary") {
    throw new HttpError(400, "Add the address first, then promote it to primary");
  }
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO account_emails (account_id, email, type, login_enabled) VALUES ($1, $2, $3, $4) RETURNING id",
      [accountId, input.email, input.type, input.login_enabled],
    );
    await audit(db, "email.added", { accountId, ip });
    return rows[0]!.id;
  } catch (err) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === "23505") throw new HttpError(409, "Email is already registered");
    if (pgErr.code === "23503") throw new HttpError(400, "Unknown email type");
    throw err;
  }
}

interface EmailRow {
  id: string;
  type: string;
}

async function ownedEmail(db: Db, accountId: string, emailId: string): Promise<EmailRow> {
  const { rows } = await db.query<EmailRow>("SELECT id, type FROM account_emails WHERE id = $1 AND account_id = $2", [
    emailId,
    accountId,
  ]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/**
 * Changes an address's purpose or sign-in flag. Promoting an address to
 * `primary` demotes the previous primary to `other`, which keeps sign-in on.
 */
export async function updateEmail(
  db: Db,
  accountId: string,
  emailId: string,
  input: { type?: string | undefined; login_enabled?: boolean | undefined },
  ip?: string,
): Promise<void> {
  const email = await ownedEmail(db, accountId, emailId);
  if (email.type === "primary") {
    if (input.type !== undefined && input.type !== "primary") {
      throw new HttpError(400, "Promote another address to primary instead");
    }
    if (input.login_enabled === false) {
      throw new HttpError(400, "The primary address must stay a sign-in address");
    }
    return;
  }

  try {
    await transaction(db, async (tx) => {
      if (input.type === "primary") {
        await tx.query(
          "UPDATE account_emails SET type = 'other' WHERE account_id = $1 AND type = 'primary'",
          [accountId],
        );
        await tx.query("UPDATE account_emails SET type = 'primary', login_enabled = true WHERE id = $1", [emailId]);
      } else {
        await tx.query(
          `UPDATE account_emails
              SET type = COALESCE($2, type), login_enabled = COALESCE($3, login_enabled)
            WHERE id = $1`,
          [emailId, input.type ?? null, input.login_enabled ?? null],
        );
      }
      await audit(tx, "email.updated", { accountId, ip });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") throw new HttpError(400, "Unknown email type");
    throw err;
  }
}

export async function removeEmail(db: Db, accountId: string, emailId: string, ip?: string): Promise<void> {
  const email = await ownedEmail(db, accountId, emailId);
  if (email.type === "primary") throw new HttpError(400, "The primary address cannot be removed");
  await db.query("DELETE FROM account_emails WHERE id = $1", [emailId]);
  await audit(db, "email.removed", { accountId, ip });
}
