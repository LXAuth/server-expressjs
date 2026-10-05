import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import {
  OrgRole,
  isValidEnumValue,
  ORG_ROLES,
  roleAtLeast,
  type AccountStatus,
} from '../lib/enums.js';

/**
 * Building the org roles map for an access token.
 *
 * Only called on login and refresh — never on `verify-token`. That is the
 * constraint that keeps the identity provider from being a per-request
 * bottleneck, so this function is deliberately allowed to be expensive.
 */

/**
 * The roles a suspended or deleted account would be refused outright. A deleted
 * account is kept as a row rather than deleted, so that audit references stay
 * resolvable; it must not be able to authenticate.
 */
export function assertAccountUsable(status: string): void {
  if (status === 'active') return;

  if (status === 'suspended') {
    throw forbidden('This account is suspended.');
  }
  if (status === 'deleted') {
    throw unauthorized('This account no longer exists.');
  }
  // An unrecognised status means a value that should have been rejected by a
  // CHECK constraint. Deny rather than guess.
  throw forbidden(`Account has an unrecognised status: ${status}.`);
}

export async function loadOrgRoles(accountId: number): Promise<Record<string, string>> {
  const memberships = await prisma.organization_members.findMany({
    where: { userId: accountId },
    select: { organizationId: true, role: true },
  });

  const roles: Record<string, string> = {};
  for (const membership of memberships) {
    roles[String(membership.organizationId)] = membership.role;
  }
  return roles;
}

/**
 * Asserts the actor holds at least `minimum` in the organization.
 *
 * Returns the role so a caller can branch on it without a second lookup — the
 * owner-only paths in task 6 need exactly that.
 */
export async function requireOrgRole(
  accountId: number,
  organizationId: number,
  minimum: OrgRole,
): Promise<OrgRole> {
  const membership = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId: accountId } },
    select: { role: true },
  });

  if (!membership) {
    throw forbidden('You are not a member of this organization.');
  }

  // A role outside the enum set should have been refused by a CHECK constraint
  // in production. Checking here means dev and prod refuse the same values.
  if (!isValidEnumValue(ORG_ROLES, membership.role)) {
    throw forbidden('Your membership role is not recognised.');
  }

  const role = membership.role;

  // `guest` is below every administrative rank, so rankAtLeast alone would let
  // a guest satisfy a `member` requirement if guest were ranked at or above it.
  // Checking membership in the organization is therefore separate from rank.
  if (role === OrgRole.guest && minimum !== OrgRole.guest) {
    throw forbidden(`This action requires ${minimum} or higher.`);
  }

  if (!roleAtLeast(role, minimum)) {
    throw forbidden(`This action requires ${minimum} or higher.`);
  }

  return role;
}

/** True when the account holds `role` exactly — used for owner-only checks. */
export async function hasExactOrgRole(
  accountId: number,
  organizationId: number,
  role: OrgRole,
): Promise<boolean> {
  const membership = await prisma.organization_members.findUnique({
    where: { organizationId_userId: { organizationId, userId: accountId } },
    select: { role: true },
  });
  return membership?.role === role;
}

export function isSuspended(status: AccountStatus | string): boolean {
  return status === 'suspended';
}
