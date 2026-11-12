import type { Config } from "../config.js";
import { transaction, type Db } from "../db/pool.js";
import { HttpError } from "../http/errors.js";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "../security/passwords.js";
import { audit } from "./audit.js";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === UNIQUE_VIOLATION && pgErr.constraint === constraint;
}

export async function registerAccount(db: Db, email: string, password: string, ip?: string): Promise<void> {
  const hash = await hashPassword(password);
  try {
    await transaction(db, async (tx) => {
      const {
        rows: [account],
      } = await tx.query<{ id: string }>(
        "INSERT INTO accounts (platform_type) SELECT id FROM platforms WHERE code_system = 'email' RETURNING id",
      );
      if (!account) throw new Error("email platform is not seeded");
      await tx.query("INSERT INTO account_property (account_id, pwd_encrypted) VALUES ($1, $2)", [account.id, hash]);
      await tx.query(
        "INSERT INTO account_emails (account_id, email, type, login_enabled) VALUES ($1, $2, 'primary', true)",
        [account.id, email],
      );
      await audit(tx, "account.created", { accountId: account.id, ip });
    });
  } catch (err) {
    if (isUniqueViolation(err, "account_emails_email_key")) {
      throw new HttpError(409, "Email is already registered");
    }
    throw err;
  }
}

interface LoginRow {
  account_id: string;
  pwd_encrypted: string;
  failed_login_count: number;
  locked: boolean;
}

/**
 * Checks an email and password. Returns the account id on success and `null`
 * for every kind of failure — unknown email, wrong password, locked or
 * disabled account — so callers cannot tell those cases apart.
 */
export async function authenticate(
  db: Db,
  config: Config,
  email: string,
  password: string,
  ctx: { clientId?: string; ip?: string | undefined } = {},
): Promise<string | null> {
  const { rows } = await db.query<LoginRow>(
    `SELECT a.id AS account_id, p.pwd_encrypted, p.failed_login_count,
            (p.locked_until IS NOT NULL AND p.locked_until > now()) AS locked
       FROM account_emails e
       JOIN accounts a ON a.id = e.account_id
       JOIN account_property p ON p.account_id = a.id
      WHERE e.email = $1 AND e.login_enabled AND a.status = 'active'`,
    [email],
  );
  const row = rows[0];
  if (!row) {
    await burnPasswordCheck(password);
    return null;
  }

  const valid = await verifyPassword(row.pwd_encrypted, password);
  const auditCtx = { accountId: row.account_id, clientId: ctx.clientId ?? null, ip: ctx.ip };

  if (row.locked) {
    await audit(db, "login.failed", auditCtx);
    return null;
  }

  if (!valid) {
    const { rows: updated } = await db.query<{ locked: boolean }>(
      `UPDATE account_property
          SET failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
              locked_until = CASE WHEN failed_login_count + 1 >= $2
                                  THEN now() + make_interval(mins => $3) ELSE locked_until END
        WHERE account_id = $1
    RETURNING locked_until IS NOT NULL AND locked_until > now() AS locked`,
      [row.account_id, config.loginMaxAttempts, config.loginLockMinutes],
    );
    await audit(db, updated[0]?.locked ? "login.locked" : "login.failed", auditCtx);
    return null;
  }

  const rehash = needsRehash(row.pwd_encrypted) ? await hashPassword(password) : null;
  await db.query(
    `UPDATE account_property
        SET failed_login_count = 0, locked_until = NULL,
            pwd_encrypted = COALESCE($2, pwd_encrypted)
      WHERE account_id = $1`,
    [row.account_id, rehash],
  );
  return row.account_id;
}

/** Verifies the current password of an account that is already authenticated. */
async function checkCurrentPassword(db: Db, accountId: string, password: string): Promise<void> {
  const { rows } = await db.query<{ pwd_encrypted: string }>(
    "SELECT pwd_encrypted FROM account_property WHERE account_id = $1",
    [accountId],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(row.pwd_encrypted, password))) {
    throw new HttpError(403, "Current password is incorrect");
  }
}

/** Changes the password and revokes every other session of the account. */
export async function changePassword(
  db: Db,
  accountId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
  ip?: string,
): Promise<void> {
  await checkCurrentPassword(db, accountId, currentPassword);
  const hash = await hashPassword(newPassword);
  await transaction(db, async (tx) => {
    await tx.query(
      "UPDATE account_property SET pwd_encrypted = $2, pwd_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE account_id = $1",
      [accountId, hash],
    );
    await tx.query(
      "UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL",
      [accountId, currentSessionId],
    );
    await audit(tx, "password.changed", { accountId, ip });
  });
}

/** Permanently deletes an account and everything that belongs to it. */
export async function deleteAccount(db: Db, accountId: string, password: string, ip?: string): Promise<void> {
  await checkCurrentPassword(db, accountId, password);
  await transaction(db, async (tx) => {
    await tx.query("DELETE FROM accounts WHERE id = $1", [accountId]);
    await audit(tx, "account.deleted", { accountId: null, ip });
  });
}
