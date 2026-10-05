import { prisma } from '../../lib/prisma.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { OrgRole } from '../../lib/enums.js';
import { requireOrgRole } from '../../lib/claims.js';
import {
  alreadyExists,
  badRequest,
  conflict,
  forbidden,
  lastOwner,
  notFound,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type {
  CreateOrganizationInput,
  InviteMemberInput,
  JoinOrganizationInput,
  ListMembersInput,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
} from './organization.schemas.js';

/**
 * Organizations and their members.
 *
 * The invariant this module exists to protect: exactly one owner per
 * organization, always. It is enforced by the `one_owner_per_org` partial unique
 * index from task 3, not by the checks here — these checks exist to produce good
 * error messages, and the index is what makes the guarantee hold under
 * concurrency.
 */

/** How long an invite stays valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublicOrganization {
  organizationId: number;
  nameId: string | null;
  nameDisplay: string | null;
  avatarUrl: string | null;
  status: string;
  memberCount: number;
  createdAt: Date;
}

function toPublicOrganization(record: {
  id: number;
  status: string;
  createdAt: Date;
  properties: {
    nameId: string;
    nameDisplay: string;
    avatarUrl: string | null;
  } | null;
  _count?: { members: number };
}): PublicOrganization {
  return {
    organizationId: record.id,
    nameId: record.properties?.nameId ?? null,
    nameDisplay: record.properties?.nameDisplay ?? null,
    avatarUrl: record.properties?.avatarUrl ?? null,
    status: record.status,
    memberCount: record._count?.members ?? 0,
    createdAt: record.createdAt,
  };
}

/**
 * `POST /organizations`
 *
 * The creator's `owner` membership is written in the same transaction as the
 * organization. Splitting them would leave a window where the organization
 * exists with no owner — unrecoverable, because the partial unique index permits
 * zero owners just as readily as two, and nothing else can fix it.
 */
export async function createOrganization(
  accountId: number,
  input: CreateOrganizationInput,
): Promise<PublicOrganization> {
  try {
    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.accounts.create({
        data: {
          type: 'organization',
          status: 'active',
          properties: {
            create: {
              nameId: input.nameId,
              nameDisplay: input.nameDisplay ?? input.nameId.replace(/^@/, ''),
            },
          },
        },
        select: { id: true },
      });

      await tx.organization_members.create({
        data: {
          organizationId: created.id,
          userId: accountId,
          role: OrgRole.owner,
        },
      });

      return created;
    });

    logger.info('Organization created', { organizationId: organization.id, accountId });

    return getOrganization(organization.id, accountId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw alreadyExists('An organization with that name already exists.');
    }
    throw error;
  }
}

/** `GET /organizations/{org_id}` — readable by any member. */
export async function getOrganization(
  organizationId: number,
  accountId: number,
): Promise<PublicOrganization> {
  await requireOrgRole(accountId, organizationId, OrgRole.guest);

  const record = await prisma.accounts.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      properties: true,
      _count: { select: { ownedOrganizations: true } },
    },
  });

  if (!record || record.type !== 'organization') {
    throw notFound('Organization', organizationId);
  }

  return toPublicOrganization({
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    properties: record.properties,
    _count: { members: record._count.ownedOrganizations },
  });
}

/** `PUT /organizations/{org_id}` — owner, co_owner, or admin. */
export async function updateOrganization(
  organizationId: number,
  accountId: number,
  input: UpdateOrganizationInput,
): Promise<PublicOrganization> {
  await requireOrgRole(accountId, organizationId, OrgRole.admin);

  // No description field: the specified DDL gives an organization none, and the
  // brief says not to restructure the specified tables. See the schema comment.
  if (input.nameDisplay !== undefined || input.avatarUrl !== undefined) {
    await prisma.account_properties.upsert({
      where: { accountId: organizationId },
      update: {
        ...(input.nameDisplay === undefined ? {} : { nameDisplay: input.nameDisplay }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      },
      create: {
        accountId: organizationId,
        nameId: `@org${organizationId}`,
        nameDisplay: input.nameDisplay ?? `Organization ${organizationId}`,
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      },
    });
  }

  return getOrganization(organizationId, accountId);
}

/**
 * `DELETE /organizations/{org_id}` — owner only.
 *
 * Soft delete: the row is marked `deleted` rather than removed. Audit rows
 * elsewhere reference account ids, and a hard delete would leave them dangling.
 * The partial unique index still applies to a deleted organization, which is
 * correct — its membership history is unchanged.
 */
export async function deleteOrganization(
  organizationId: number,
  accountId: number,
): Promise<void> {
  const role = await requireOrgRole(accountId, organizationId, OrgRole.guest);
  if (role !== OrgRole.owner) {
    throw forbidden('Only the owner can delete an organization.');
  }

  await prisma.accounts.update({
    where: { id: organizationId },
    data: { status: 'deleted' },
  });

  logger.info('Organization soft deleted', { organizationId, accountId });
}

/** `GET /organizations/{org_id}/members` */
export async function listMembers(
  organizationId: number,
  accountId: number,
  input: ListMembersInput,
): Promise<{
  members: Array<{
    userId: number;
    role: string;
    joinedAt: Date;
    nameId: string | null;
    nameDisplay: string | null;
    avatarUrl: string | null;
    email: string | null;
  }>;
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}> {
  await requireOrgRole(accountId, organizationId, OrgRole.guest);

  const where = {
    organizationId,
    ...(input.role === undefined ? {} : { role: input.role }),
  };

  const [members, total] = await Promise.all([
    prisma.organization_members.findMany({
      where,
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: {
          select: {
            properties: { select: { nameId: true, nameDisplay: true, avatarUrl: true } },
            emails: {
              where: { isPrimary: true },
              select: { email: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      skip: (input.page - 1) * input.perPage,
      take: input.perPage,
    }),
    prisma.organization_members.count({ where }),
  ]);

  return {
    members: members.map((membership) => ({
      userId: membership.userId,
      role: membership.role,
      joinedAt: membership.joinedAt,
      nameId: membership.user.properties?.nameId ?? null,
      nameDisplay: membership.user.properties?.nameDisplay ?? null,
      avatarUrl: membership.user.properties?.avatarUrl ?? null,
      email: membership.user.emails[0]?.email ?? null,
    })),
    pagination: {
      page: input.page,
      perPage: input.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.perPage)),
    },
  };
}

/**
 * `POST /organizations/{org_id}/members/invite`
 *
 * The token is returned in the response because this build has no mail
 * transport. It is stored only as a hash, so the database yields nothing an
 * attacker can redeem even if it is dumped.
 */
export async function inviteMember(
  organizationId: number,
  accountId: number,
  input: InviteMemberInput,
): Promise<{ inviteId: number; email: string; role: string; token: string; expiresAt: Date }> {
  const inviterRole = await requireOrgRole(accountId, organizationId, OrgRole.admin);

  // An admin must not be able to mint an admin or an owner.
  if (inviterRole === OrgRole.admin && (input.role === OrgRole.admin || input.role === OrgRole.co_owner)) {
    throw forbidden('An admin cannot invite anyone at admin level or above.');
  }

  const existing = await prisma.organization_members.findFirst({
    where: {
      organizationId,
      user: { emails: { some: { email: input.email } } },
    },
    select: { userId: true },
  });

  if (existing) {
    throw conflict('That person is already a member of this organization.');
  }

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await prisma.organization_invites.create({
    data: {
      organizationId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: accountId,
      expiresAt,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });

  logger.info('Member invited', {
    organizationId,
    inviteId: invite.id,
    invitedBy: accountId,
    role: input.role,
  });

  return { inviteId: invite.id, ...invite, token };
}

/**
 * `POST /organizations/{org_id}/members/join`
 *
 * Redeems an invite. `acceptedAt` makes it single-use, and the redemption and
 * the membership write share a transaction so a crash between them cannot leave
 * a spent invite with no member.
 */
export async function joinOrganization(
  organizationId: number,
  accountId: number,
  input: JoinOrganizationInput,
): Promise<{ role: string }> {
  const tokenHash = hashToken(input.token);

  const invite = await prisma.organization_invites.findFirst({
    where: { organizationId, tokenHash },
    select: {
      id: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      email: true,
    },
  });

  if (!invite) {
    throw badRequest('Invite token is not recognised for this organization.');
  }
  if (invite.acceptedAt !== null) {
    throw conflict('This invite has already been used.');
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw badRequest('This invite has expired.');
  }

  // The invite names an email, so redemption only works from an account that
  // actually holds that address. Without this, a leaked invite link is a
  // transferable membership.
  const ownsEmail = await prisma.account_emails.findFirst({
    where: { accountId, email: invite.email, isVerified: true },
    select: { id: true },
  });

  if (!ownsEmail) {
    throw forbidden('This invite was issued to a different email address.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.organization_invites.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    await tx.organization_members.upsert({
      where: { organizationId_userId: { organizationId, userId: accountId } },
      update: { role: invite.role },
      create: { organizationId, userId: accountId, role: invite.role },
    });
  });

  logger.info('Invite redeemed', { organizationId, accountId, role: invite.role });

  return { role: invite.role };
}

/**
 * `PUT /organizations/{org_id}/members/{user_id}/role`
 *
 * Promoting someone to `owner` is where the invariant is at risk, and this is
 * the code that handles it. The sequence:
 *
 *   1. Refuse if the target is already the owner — a no-op that would otherwise
 *      trip the index.
 *   2. Demote the current owner to `co_owner` first.
 *   3. Promote the target.
 *
 * Steps 2 and 3 run in one transaction. The demotion must come first: the index
 * permits one owner, so promoting before demoting would fail on the intermediate
 * state even inside a transaction. Demoting first is always safe.
 *
 * The index is still the backstop. Two concurrent requests to promote different
 * users both read "current owner is X", both try to demote X and promote their
 * own target; the transactions serialise, and the loser's insert violates
 * `one_owner_per_org`. That surfaces as the `last_owner` conflict below.
 */
export async function updateMemberRole(
  organizationId: number,
  accountId: number,
  targetUserId: number,
  input: UpdateMemberRoleInput,
): Promise<{ userId: number; role: string; previousRole: string }> {
  const actorRole = await requireOrgRole(accountId, organizationId, OrgRole.admin);

  if (targetUserId === accountId && input.role !== OrgRole.owner && actorRole === OrgRole.owner) {
    throw lastOwner('Demote another member to owner before changing your own role.');
  }

  const target = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
    select: { role: true },
  });

  if (!target) {
    throw notFound('Member', targetUserId);
  }

  if (target.role === input.role) {
    return { userId: targetUserId, role: input.role, previousRole: target.role };
  }

  // An admin cannot promote to a rank at or above its own.
  if (actorRole === OrgRole.admin && (input.role === OrgRole.admin || input.role === OrgRole.co_owner || input.role === OrgRole.owner)) {
    throw forbidden('An admin cannot grant admin, co_owner, or owner.');
  }

  try {
    if (input.role === OrgRole.owner) {
      await prisma.$transaction(async (tx) => {
        const currentOwner = await tx.organization_members.findFirst({
          where: { organizationId, role: OrgRole.owner },
          select: { userId: true },
        });

        if (currentOwner && currentOwner.userId !== targetUserId) {
          await tx.organization_members.update({
            where: {
              organizationId_userId: {
                organizationId,
                userId: currentOwner.userId,
              },
            },
            data: { role: OrgRole.co_owner },
          });
        }

        await tx.organization_members.update({
          where: { organizationId_userId: { organizationId, userId: targetUserId } },
          data: { role: OrgRole.owner },
        });
      });
    } else {
      // Demoting the owner through this path would leave nobody able to
      // administer the organization.
      if (target.role === OrgRole.owner) {
        throw lastOwner(
          'Promote another member to owner before demoting the current one.',
        );
      }

      await prisma.organization_members.update({
        where: { organizationId_userId: { organizationId, userId: targetUserId } },
        data: { role: input.role },
      });
    }
  } catch (error) {
    // The index refused the write. Two concurrent promotions is the usual cause.
    if (isUniqueViolation(error)) {
      throw lastOwner(
        'Another promotion completed first. Reload and try again.',
      );
    }
    throw error;
  }

  logger.info('Member role changed', {
    organizationId,
    targetUserId,
    from: target.role,
    to: input.role,
    by: accountId,
  });

  return { userId: targetUserId, role: input.role, previousRole: target.role };
}

/**
 * `DELETE /organizations/{org_id}/members/{user_id}`
 *
 * Refuses to remove the owner. Use the role endpoint to transfer ownership
 * first — this is the same rule as the index, stated where a user will see it.
 */
export async function removeMember(
  organizationId: number,
  accountId: number,
  targetUserId: number,
): Promise<void> {
  const actorRole = await requireOrgRole(accountId, organizationId, OrgRole.admin);

  // An admin may remove members and guests, but not peers.
  if (actorRole === OrgRole.admin) {
    const target = await prisma.organization_members.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      select: { role: true },
    });
    if (target && target.role !== OrgRole.member && target.role !== OrgRole.guest) {
      throw forbidden('An admin cannot remove an admin, co_owner, or owner.');
    }
  }

  const target = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
    select: { role: true },
  });

  if (!target) {
    throw notFound('Member', targetUserId);
  }

  if (target.role === OrgRole.owner) {
    throw lastOwner(
      'Promote another member to owner before removing the current one.',
    );
  }

  await prisma.organization_members.delete({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });

  logger.info('Member removed', { organizationId, targetUserId, by: accountId });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
