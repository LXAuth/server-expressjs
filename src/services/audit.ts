import type { Queryable } from "../db/pool.js";

export type AuditEvent =
  | "account.created"
  | "account.deleted"
  | "login.succeeded"
  | "login.failed"
  | "login.locked"
  | "session.revoked"
  | "password.changed"
  | "email.added"
  | "email.updated"
  | "email.removed"
  | "client.created"
  | "client.updated"
  | "client.secret_rotated"
  | "client.revoked"
  | "connection.linked"
  | "connection.unlinked"
  | "organization.created"
  | "organization.updated"
  | "organization.deleted"
  | "organization.member_role_changed"
  | "organization.member_removed"
  | "organization.ownership_transferred"
  | "organization.invite_created"
  | "organization.invite_revoked"
  | "organization.invite_accepted"
  | "team.created"
  | "team.updated"
  | "team.deleted"
  | "team.member_changed"
  | "team.member_removed"
  | "wallet.linked"
  | "wallet.unlinked"
  | "wallet.login_failed";

export interface AuditContext {
  accountId?: string | null;
  clientId?: string | null;
  ip?: string | undefined;
}

export async function audit(db: Queryable, event: AuditEvent, ctx: AuditContext): Promise<void> {
  await db.query("INSERT INTO audit_events (account_id, client_id, event, ip_address) VALUES ($1, $2, $3, $4)", [
    ctx.accountId ?? null,
    ctx.clientId ?? null,
    event,
    ctx.ip ?? null,
  ]);
}
