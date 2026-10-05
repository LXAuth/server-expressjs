import { prisma } from '../../lib/prisma.js';
import { OrgRole } from '../../lib/enums.js';
import { requireOrgRole } from '../../lib/claims.js';
import { alreadyExists, badRequest, conflict, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  ListTeamsInput,
  UpdateTeamInput,
} from './team.schemas.js';

/**
 * Teams within an organization.
 *
 * Teams are subordinate to the organization: every operation starts by checking
 * the caller's organization role, never a team role. A team role says who
 * coordinates the team's work, not what the team may do to the organization.
 */

export interface PublicTeam {
  teamId: number;
  organizationId: number;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Confirms the team exists and belongs to the organization named in the path.
 *
 * Without this check, `GET /organizations/1/teams/7` would happily return team 7
 * even if it belongs to organization 2 — a cross-tenant read that a bare
 * `findUnique` on the team id would allow.
 */
async function requireTeam(organizationId: number, teamId: number) {
  const team = await prisma.organization_teams.findFirst({
    where: { id: teamId, organizationId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true } },
    },
  });

  if (!team) {
    throw notFound('Team', teamId);
  }
  return team;
}

function toPublicTeam(team: {
  id: number;
  organizationId: number;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number };
}): PublicTeam {
  return {
    teamId: team.id,
    organizationId: team.organizationId,
    name: team.name,
    description: team.description,
    memberCount: team._count.members,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

/** `GET /organizations/{org_id}/teams` */
export async function listTeams(
  organizationId: number,
  accountId: number,
  input: ListTeamsInput,
): Promise<{
  teams: PublicTeam[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}> {
  await requireOrgRole(accountId, organizationId, OrgRole.guest);

  const where = { organizationId };
  const [teams, total] = await Promise.all([
    prisma.organization_teams.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (input.page - 1) * input.perPage,
      take: input.perPage,
    }),
    prisma.organization_teams.count({ where }),
  ]);

  return {
    teams: teams.map(toPublicTeam),
    pagination: {
      page: input.page,
      perPage: input.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.perPage)),
    },
  };
}

/** `GET /organizations/{org_id}/teams/{team_id}` */
export async function getTeam(
  organizationId: number,
  teamId: number,
  accountId: number,
): Promise<PublicTeam> {
  await requireOrgRole(accountId, organizationId, OrgRole.guest);
  return toPublicTeam(await requireTeam(organizationId, teamId));
}

/** `POST /organizations/{org_id}/teams` — admin and above. */
export async function createTeam(
  organizationId: number,
  accountId: number,
  input: CreateTeamInput,
): Promise<PublicTeam> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);

  const duplicate = await prisma.organization_teams.findFirst({
    where: { organizationId, name: input.name },
    select: { id: true },
  });

  if (duplicate) {
    throw alreadyExists('A team with that name', { organizationId });
  }

  const team = await prisma.organization_teams.create({
    data: {
      organizationId,
      name: input.name,
      description: input.description ?? null,
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true } },
    },
  });

  logger.info('Team created', { organizationId, teamId: team.id, by: accountId });

  return toPublicTeam(team);
}

/** `PUT /organizations/{org_id}/teams/{team_id}` — admin and above. */
export async function updateTeam(
  organizationId: number,
  teamId: number,
  accountId: number,
  input: UpdateTeamInput,
): Promise<PublicTeam> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);
  await requireTeam(organizationId, teamId);

  if (input.name !== undefined) {
    const duplicate = await prisma.organization_teams.findFirst({
      where: { organizationId, name: input.name, id: { not: teamId } },
      select: { id: true },
    });
    if (duplicate) {
      throw alreadyExists('A team with that name', { organizationId });
    }
  }

  const team = await prisma.organization_teams.update({
    where: { id: teamId },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      updatedAt: new Date(),
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { members: true } },
    },
  });

  return toPublicTeam(team);
}

/** `DELETE /organizations/{org_id}/teams/{team_id}` — admin and above. */
export async function deleteTeam(
  organizationId: number,
  teamId: number,
  accountId: number,
): Promise<void> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);
  await requireTeam(organizationId, teamId);

  // organization_team_members cascades from the team, so members go with it.
  await prisma.organization_teams.delete({ where: { id: teamId } });

  logger.info('Team deleted', { organizationId, teamId, by: accountId });
}

/**
 * `GET /organizations/{org_id}/teams/{team_id}/members`
 *
 * Readable by any organization member. Team membership is not private within an
 * organization — knowing who is on a team is ordinary coordination information.
 */
export async function listTeamMembers(
  organizationId: number,
  teamId: number,
  accountId: number,
): Promise<
  Array<{
    userId: number;
    role: string;
    joinedAt: Date;
    nameId: string | null;
    nameDisplay: string | null;
    avatarUrl: string | null;
  }>
> {
  await requireOrgRole(accountId, organizationId, OrgRole.guest);
  await requireTeam(organizationId, teamId);

  const members = await prisma.organization_team_members.findMany({
    where: { teamId },
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: {
        select: {
          properties: { select: { nameId: true, nameDisplay: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return members.map((membership) => ({
    userId: membership.userId,
    role: membership.role,
    joinedAt: membership.joinedAt,
    nameId: membership.user.properties?.nameId ?? null,
    nameDisplay: membership.user.properties?.nameDisplay ?? null,
    avatarUrl: membership.user.properties?.avatarUrl ?? null,
  }));
}

/**
 * `POST /organizations/{org_id}/teams/{team_id}/members`
 *
 * The user must already belong to the organization. A team is a grouping within
 * an organization, so adding a non-member would create a member of the team who
 * is not a member of the organization that owns it — and their access token
 * would carry no role for it.
 */
export async function addTeamMember(
  organizationId: number,
  teamId: number,
  accountId: number,
  input: AddTeamMemberInput,
): Promise<{ teamId: number; userId: number; role: string }> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);
  await requireTeam(organizationId, teamId);

  const isMember = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId: input.userId } },
    select: { userId: true },
  });

  if (!isMember) {
    throw badRequest('That user is not a member of this organization.');
  }

  const existing = await prisma.organization_team_members.findUnique({
    where: { teamId_userId: { teamId, userId: input.userId } },
    select: { role: true },
  });

  if (existing) {
    throw conflict('That user is already on this team.', { teamId, userId: input.userId });
  }

  await prisma.organization_team_members.create({
    data: { teamId, userId: input.userId, role: input.role },
  });

  logger.info('Team member added', { organizationId, teamId, userId: input.userId, by: accountId });

  return { teamId, userId: input.userId, role: input.role };
}

/** `DELETE /organizations/{org_id}/teams/{team_id}/members/{user_id}` */
export async function removeTeamMember(
  organizationId: number,
  teamId: number,
  targetUserId: number,
  accountId: number,
): Promise<void> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);
  await requireTeam(organizationId, teamId);

  const existing = await prisma.organization_team_members.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    select: { userId: true },
  });

  if (!existing) {
    throw notFound('Team member', targetUserId);
  }

  await prisma.organization_team_members.delete({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });

  logger.info('Team member removed', { organizationId, teamId, userId: targetUserId, by: accountId });
}
