import { transaction, type Db, type Queryable } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { randomToken, sha256Hex } from "../security/crypto.js";
import { audit } from "./audit.js";
import { atLeast, rank, type OrgRole } from "./roles.js";

export const accessDenied = () => new HttpError(403, "Access denied");

const UNIQUE_VIOLATION = "23505";
const isUnique = (err: unknown, constraint?: string) => {
  const e = err as { code?: string; constraint?: string };
  return e.code === UNIQUE_VIOLATION && (constraint === undefined || e.constraint === constraint);
};

/** The caller's role in an organization, or `null` when not a member (or no such org). */
export async function roleIn(db: Queryable, orgId: string, accountId: string): Promise<OrgRole | null> {
  const { rows } = await db.query<{ role: OrgRole }>(
    "SELECT role FROM organization_members WHERE organization_id = $1 AND account_id = $2",
    [orgId, accountId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Loads the caller's role and enforces a minimum. A non-member gets 404 so the
 * organization's existence is not revealed; a member below the bar gets 403.
 */
export async function requireRole(db: Queryable, orgId: string, accountId: string, min: OrgRole): Promise<OrgRole> {
  const role = await roleIn(db, orgId, accountId);
  if (!role) throw notFound();
  if (!atLeast(role, min)) throw accessDenied();
  return role;
}

// ---- Organizations --------------------------------------------------------

export async function createOrganization(
  db: Db,
  accountId: string,
  input: { slug: string; name: string },
  ip?: string,
): Promise<string> {
  try {
    return await transaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id",
        [input.slug, input.name],
      );
      const id = rows[0]!.id;
      await tx.query(
        "INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, 'owner')",
        [id, accountId],
      );
      await audit(tx, "organization.created", { accountId, ip });
      return id;
    });
  } catch (err) {
    if (isUnique(err)) throw new HttpError(409, "That slug is taken");
    throw err;
  }
}

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
  created_at: Date;
}

export async function listMyOrganizations(db: Db, accountId: string): Promise<OrganizationSummary[]> {
  const { rows } = await db.query<OrganizationSummary>(
    `SELECT o.id, o.slug, o.name, m.role, o.created_at
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.account_id = $1 ORDER BY o.name`,
    [accountId],
  );
  return rows;
}

export async function getOrganization(db: Db, orgId: string, accountId: string): Promise<OrganizationSummary> {
  const { rows } = await db.query<OrganizationSummary>(
    `SELECT o.id, o.slug, o.name, m.role, o.created_at
       FROM organizations o JOIN organization_members m ON m.organization_id = o.id
      WHERE o.id = $1 AND m.account_id = $2`,
    [orgId, accountId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function updateOrganization(
  db: Db,
  orgId: string,
  accountId: string,
  input: { slug?: string | undefined; name?: string | undefined },
  ip?: string,
): Promise<void> {
  await requireRole(db, orgId, accountId, "admin");
  try {
    await db.query("UPDATE organizations SET slug = COALESCE($2, slug), name = COALESCE($3, name) WHERE id = $1", [
      orgId,
      input.slug ?? null,
      input.name ?? null,
    ]);
  } catch (err) {
    if (isUnique(err)) throw new HttpError(409, "That slug is taken");
    throw err;
  }
  await audit(db, "organization.updated", { accountId, ip });
}

export async function deleteOrganization(db: Db, orgId: string, accountId: string, ip?: string): Promise<void> {
  await requireRole(db, orgId, accountId, "owner");
  await db.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  await audit(db, "organization.deleted", { accountId, ip });
}

// ---- Members --------------------------------------------------------------

export interface MemberSummary {
  account_id: string;
  name_id: string | null;
  name_display: string | null;
  avatar_url: string | null;
  role: OrgRole;
  joined_at: Date;
}

/** Members see each other by profile, never by email. Guests cannot list members. */
export async function listMembers(db: Db, orgId: string, accountId: string): Promise<MemberSummary[]> {
  await requireRole(db, orgId, accountId, "member");
  const { rows } = await db.query<MemberSummary>(
    `SELECT m.account_id, p.name_id, p.name_display, p.avatar_url, m.role, m.joined_at
       FROM organization_members m
       LEFT JOIN account_property p ON p.account_id = m.account_id
      WHERE m.organization_id = $1
      ORDER BY array_position(ARRAY['owner','co_owner','admin','member','guest']::varchar[], m.role), m.joined_at`,
    [orgId],
  );
  return rows;
}

/**
 * Changes a member's role. The actor must be an admin or above and outrank both
 * the member's current role and the new one; the owner may also appoint
 * co-owners. Ownership only moves through `transferOwnership`.
 */
export async function changeMemberRole(
  db: Db,
  orgId: string,
  actorId: string,
  targetId: string,
  newRole: OrgRole,
  ip?: string,
): Promise<void> {
  if (newRole === "owner") throw new HttpError(400, "Use the transfer endpoint to change the owner");
  const actor = await requireRole(db, orgId, actorId, "admin");
  const target = await roleIn(db, orgId, targetId);
  if (!target) throw notFound();
  if (target === "owner") throw new HttpError(400, "Use the transfer endpoint to change the owner");
  const canAssign = actor === "owner" || rank(actor) > rank(newRole);
  if (rank(actor) <= rank(target) || !canAssign) throw accessDenied();

  await db.query("UPDATE organization_members SET role = $3 WHERE organization_id = $1 AND account_id = $2", [
    orgId,
    targetId,
    newRole,
  ]);
  await audit(db, "organization.member_role_changed", { accountId: actorId, ip });
}

/** Removes a member. Anyone but the owner may leave; admins and above may remove lower roles. */
export async function removeMember(db: Db, orgId: string, actorId: string, targetId: string, ip?: string): Promise<void> {
  const actor = await roleIn(db, orgId, actorId);
  if (!actor) throw notFound();
  const target = actorId === targetId ? actor : await roleIn(db, orgId, targetId);
  if (!target) throw notFound();
  if (target === "owner") throw new HttpError(400, "The owner cannot leave; transfer ownership first");
  if (actorId !== targetId && (!atLeast(actor, "admin") || rank(actor) <= rank(target))) throw accessDenied();

  await db.query("DELETE FROM organization_members WHERE organization_id = $1 AND account_id = $2", [orgId, targetId]);
  await audit(db, "organization.member_removed", { accountId: actorId, ip });
}

/** Makes another member the owner; the previous owner becomes a co-owner. */
export async function transferOwnership(db: Db, orgId: string, actorId: string, targetId: string, ip?: string): Promise<void> {
  if (actorId === targetId) throw new HttpError(400, "You already own this organization");
  await transaction(db, async (tx) => {
    // Lock the membership rows so a concurrent transfer cannot interleave.
    const { rows } = await tx.query<{ account_id: string; role: OrgRole }>(
      `SELECT account_id, role FROM organization_members
        WHERE organization_id = $1 AND account_id IN ($2, $3) FOR UPDATE`,
      [orgId, actorId, targetId],
    );
    const actor = rows.find((r) => r.account_id === actorId)?.role;
    const target = rows.find((r) => r.account_id === targetId)?.role;
    if (!actor) throw notFound();
    if (actor !== "owner") throw accessDenied();
    if (!target) throw notFound();
    // Demote first: the one-owner index would reject the promotion otherwise.
    await tx.query(
      "UPDATE organization_members SET role = 'co_owner' WHERE organization_id = $1 AND account_id = $2",
      [orgId, actorId],
    );
    await tx.query("UPDATE organization_members SET role = 'owner' WHERE organization_id = $1 AND account_id = $2", [
      orgId,
      targetId,
    ]);
    await audit(tx, "organization.ownership_transferred", { accountId: actorId, ip });
  });
}

// ---- Invitations ----------------------------------------------------------

export const INVITE_TOKEN_PREFIX = "lxi";

export async function createInvite(
  db: Db,
  orgId: string,
  actorId: string,
  input: { role: OrgRole; email?: string | undefined; expires_in_hours: number },
  ip?: string,
): Promise<{ id: string; invite_token: string; expires_at: Date }> {
  const actor = await requireRole(db, orgId, actorId, "admin");
  if (input.role === "owner") throw new HttpError(400, "An invite cannot make someone the owner");
  if (actor !== "owner" && rank(input.role) >= rank(actor)) throw accessDenied();

  const token = randomToken(INVITE_TOKEN_PREFIX);
  const { rows } = await db.query<{ id: string; expires_at: Date }>(
    `INSERT INTO organization_invites (organization_id, token_hash, role, email, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
     RETURNING id, expires_at`,
    [orgId, sha256Hex(token), input.role, input.email ?? null, actorId, input.expires_in_hours],
  );
  await audit(db, "organization.invite_created", { accountId: actorId, ip });
  return { id: rows[0]!.id, invite_token: token, expires_at: rows[0]!.expires_at };
}

export interface InviteSummary {
  id: string;
  role: OrgRole;
  email: string | null;
  expires_at: Date;
  created_at: Date;
}

export async function listInvites(db: Db, orgId: string, actorId: string): Promise<InviteSummary[]> {
  await requireRole(db, orgId, actorId, "admin");
  const { rows } = await db.query<InviteSummary>(
    `SELECT id, role, email, expires_at, created_at FROM organization_invites
      WHERE organization_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at`,
    [orgId],
  );
  return rows;
}

export async function revokeInvite(db: Db, orgId: string, actorId: string, inviteId: string, ip?: string): Promise<void> {
  await requireRole(db, orgId, actorId, "admin");
  const { rowCount } = await db.query(
    "DELETE FROM organization_invites WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL",
    [inviteId, orgId],
  );
  if (!rowCount) throw notFound();
  await audit(db, "organization.invite_revoked", { accountId: actorId, ip });
}

/**
 * Accepts an invitation. Every reason it cannot be used — unknown, expired,
 * already used, or meant for another address — gives the same answer.
 */
export async function acceptInvite(db: Db, accountId: string, token: string, ip?: string): Promise<void> {
  const invalid = () => new HttpError(400, "Invalid or expired invite");
  if (!token.startsWith(`${INVITE_TOKEN_PREFIX}_`) || token.length > 128) throw invalid();

  await transaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; organization_id: string; role: OrgRole; email: string | null }>(
      `SELECT id, organization_id, role, email FROM organization_invites
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [sha256Hex(token)],
    );
    const invite = rows[0];
    if (!invite) throw invalid();
    if (invite.email) {
      const owns = await tx.query("SELECT 1 FROM account_emails WHERE account_id = $1 AND email = $2", [
        accountId,
        invite.email,
      ]);
      if (!owns.rowCount) throw invalid();
    }
    try {
      await tx.query("INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, $3)", [
        invite.organization_id,
        accountId,
        invite.role,
      ]);
    } catch (err) {
      if (isUnique(err)) throw new HttpError(409, "You are already a member of this organization");
      throw err;
    }
    await tx.query("UPDATE organization_invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1", [
      invite.id,
      accountId,
    ]);
    await audit(tx, "organization.invite_accepted", { accountId, ip });
  });
}

/** Ids of organizations this account owns; an owner must transfer or delete them before leaving. */
export async function ownedOrganizationCount(db: Queryable, accountId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM organization_members WHERE account_id = $1 AND role = 'owner'",
    [accountId],
  );
  return rows[0]?.n ?? 0;
}
