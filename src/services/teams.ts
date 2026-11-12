import type { Db, Queryable } from "../db/pool.js";
import { HttpError, notFound } from "../http/errors.js";
import { audit } from "./audit.js";
import { accessDenied, requireRole } from "./organizations.js";
import { atLeast, type OrgRole } from "./roles.js";

export const TEAM_ROLES = ["lead", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

interface TeamContext {
  orgId: string;
  orgRole: OrgRole;
  teamRole: TeamRole | null;
}

/** Org admins and above manage every team in their organization. */
const isOrgAdmin = (ctx: TeamContext) => atLeast(ctx.orgRole, "admin");

/**
 * The caller's standing in a team. A team outside the caller's organizations
 * is indistinguishable from one that does not exist.
 */
export async function teamContext(db: Queryable, teamId: string, accountId: string): Promise<TeamContext | null> {
  const { rows } = await db.query<{ organization_id: string; org_role: OrgRole; team_role: TeamRole | null }>(
    `SELECT t.organization_id, om.role AS org_role, tm.role AS team_role
       FROM teams t
       JOIN organization_members om ON om.organization_id = t.organization_id AND om.account_id = $2
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.account_id = $2
      WHERE t.id = $1`,
    [teamId, accountId],
  );
  const row = rows[0];
  return row ? { orgId: row.organization_id, orgRole: row.org_role, teamRole: row.team_role } : null;
}

async function requireTeam(db: Queryable, teamId: string, accountId: string): Promise<TeamContext> {
  const ctx = await teamContext(db, teamId, accountId);
  // Guests only see the teams they are on.
  if (!ctx || (ctx.orgRole === "guest" && !ctx.teamRole)) throw notFound();
  return ctx;
}

const isUnique = (err: unknown) => (err as { code?: string }).code === "23505";

export async function createTeam(
  db: Db,
  orgId: string,
  accountId: string,
  input: { name: string; description?: string | null | undefined },
  ip?: string,
): Promise<string> {
  await requireRole(db, orgId, accountId, "admin");
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO teams (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id",
      [orgId, input.name, input.description ?? null],
    );
    await audit(db, "team.created", { accountId, ip });
    return rows[0]!.id;
  } catch (err) {
    if (isUnique(err)) throw new HttpError(409, "A team with that name already exists");
    throw err;
  }
}

export interface TeamSummary {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  role: TeamRole | null;
  created_at: Date;
}

export async function listTeams(db: Db, orgId: string, accountId: string): Promise<TeamSummary[]> {
  const orgRole = await requireRole(db, orgId, accountId, "guest");
  const { rows } = await db.query<TeamSummary>(
    `SELECT t.id, t.organization_id, t.name, t.description, tm.role, t.created_at
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.account_id = $2
      WHERE t.organization_id = $1 AND ($3::boolean OR tm.account_id IS NOT NULL)
      ORDER BY lower(t.name)`,
    [orgId, accountId, orgRole !== "guest"],
  );
  return rows;
}

export async function getTeam(db: Db, teamId: string, accountId: string): Promise<TeamSummary> {
  await requireTeam(db, teamId, accountId);
  const { rows } = await db.query<TeamSummary>(
    `SELECT t.id, t.organization_id, t.name, t.description, tm.role, t.created_at
       FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.account_id = $2
      WHERE t.id = $1`,
    [teamId, accountId],
  );
  return rows[0]!;
}

export async function updateTeam(
  db: Db,
  teamId: string,
  accountId: string,
  input: { name?: string | undefined; description?: string | null | undefined },
  ip?: string,
): Promise<void> {
  const ctx = await requireTeam(db, teamId, accountId);
  if (!isOrgAdmin(ctx) && ctx.teamRole !== "lead") throw accessDenied();
  try {
    await db.query(
      `UPDATE teams SET name = COALESCE($2, name),
                        description = CASE WHEN $3::boolean THEN $4 ELSE description END
        WHERE id = $1`,
      [teamId, input.name ?? null, input.description !== undefined, input.description ?? null],
    );
  } catch (err) {
    if (isUnique(err)) throw new HttpError(409, "A team with that name already exists");
    throw err;
  }
  await audit(db, "team.updated", { accountId, ip });
}

export async function deleteTeam(db: Db, teamId: string, accountId: string, ip?: string): Promise<void> {
  const ctx = await requireTeam(db, teamId, accountId);
  if (!isOrgAdmin(ctx)) throw accessDenied();
  await db.query("DELETE FROM teams WHERE id = $1", [teamId]);
  await audit(db, "team.deleted", { accountId, ip });
}

export interface TeamMemberSummary {
  account_id: string;
  name_id: string | null;
  name_display: string | null;
  avatar_url: string | null;
  role: TeamRole;
  joined_at: Date;
}

export async function listTeamMembers(db: Db, teamId: string, accountId: string): Promise<TeamMemberSummary[]> {
  await requireTeam(db, teamId, accountId);
  const { rows } = await db.query<TeamMemberSummary>(
    `SELECT tm.account_id, p.name_id, p.name_display, p.avatar_url, tm.role, tm.joined_at
       FROM team_members tm LEFT JOIN account_property p ON p.account_id = tm.account_id
      WHERE tm.team_id = $1
      ORDER BY (tm.role = 'lead') DESC, tm.joined_at`,
    [teamId],
  );
  return rows;
}

/**
 * Adds a member or changes their team role. Org admins manage anyone; a team
 * lead may add and manage plain members only.
 */
export async function putTeamMember(
  db: Db,
  teamId: string,
  actorId: string,
  targetId: string,
  role: TeamRole,
  ip?: string,
): Promise<"added" | "updated"> {
  const ctx = await requireTeam(db, teamId, actorId);
  const admin = isOrgAdmin(ctx);
  if (!admin && ctx.teamRole !== "lead") throw accessDenied();

  const { rows: current } = await db.query<{ role: TeamRole }>(
    "SELECT role FROM team_members WHERE team_id = $1 AND account_id = $2",
    [teamId, targetId],
  );
  if (!admin && (role === "lead" || current[0]?.role === "lead")) throw accessDenied();

  try {
    await db.query(
      `INSERT INTO team_members (team_id, organization_id, account_id, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (team_id, account_id) DO UPDATE SET role = EXCLUDED.role`,
      [teamId, ctx.orgId, targetId, role],
    );
  } catch (err) {
    // The composite foreign key: the target is not in the organization.
    if ((err as { code?: string }).code === "23503") {
      throw new HttpError(400, "Only members of the organization can join its teams");
    }
    throw err;
  }
  await audit(db, "team.member_changed", { accountId: actorId, ip });
  return current[0] ? "updated" : "added";
}

/** Removes a member. Anyone may leave; leads remove plain members; org admins remove anyone. */
export async function removeTeamMember(db: Db, teamId: string, actorId: string, targetId: string, ip?: string): Promise<void> {
  const ctx = await requireTeam(db, teamId, actorId);
  if (actorId !== targetId && !isOrgAdmin(ctx)) {
    if (ctx.teamRole !== "lead") throw accessDenied();
    const { rows } = await db.query<{ role: TeamRole }>(
      "SELECT role FROM team_members WHERE team_id = $1 AND account_id = $2",
      [teamId, targetId],
    );
    if (rows[0]?.role === "lead") throw accessDenied();
  }
  const { rowCount } = await db.query("DELETE FROM team_members WHERE team_id = $1 AND account_id = $2", [
    teamId,
    targetId,
  ]);
  if (!rowCount) throw notFound();
  await audit(db, "team.member_removed", { accountId: actorId, ip });
}

/** For the access check: team role, or any team role for org owners, co-owners, and admins. */
export async function hasTeamAccess(db: Db, teamId: string, accountId: string, required: TeamRole): Promise<boolean> {
  const ctx = await teamContext(db, teamId, accountId);
  if (!ctx) return false;
  if (isOrgAdmin(ctx)) return true;
  if (!ctx.teamRole) return false;
  return required === "member" || ctx.teamRole === "lead";
}
