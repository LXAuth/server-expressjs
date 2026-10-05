/**
 * The four enum value sets from the schema.
 *
 * These live here rather than in `schema.prisma` because Prisma cannot declare
 * an `enum` on SQLite, and this project runs SQLite in development and Postgres
 * in production. Keeping the values in TypeScript gives one source of truth for
 * both, and the Postgres migration adds CHECK constraints so the database still
 * rejects a bad value on its own.
 *
 * Each set is an `as const` object, so `AccountType.user` is the value and the
 * derived union type is what a function signature asks for.
 */

export const AccountType = {
  user: 'user',
  organization: 'organization',
  agent: 'agent',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountStatus = {
  active: 'active',
  suspended: 'suspended',
  deleted: 'deleted',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const MembershipTier = {
  free: 'free',
  premium: 'premium',
  enterprise: 'enterprise',
} as const;
export type MembershipTier = (typeof MembershipTier)[keyof typeof MembershipTier];

export const OrgRole = {
  owner: 'owner',
  co_owner: 'co_owner',
  admin: 'admin',
  member: 'member',
  guest: 'guest',
} as const;
export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole];

export const ACCOUNT_TYPES = Object.values(AccountType) as readonly AccountType[];
export const ACCOUNT_STATUSES = Object.values(AccountStatus) as readonly AccountStatus[];
export const MEMBERSHIP_TIERS = Object.values(MembershipTier) as readonly MembershipTier[];
export const ORG_ROLES = Object.values(OrgRole) as readonly OrgRole[];

/**
 * Ranks used when deciding whether an actor may act on an organization. Higher
 * is more privileged. `guest` is deliberately not a member of this list — a
 * guest can read an organization it was invited to see but holds no management
 * rights, so authorization checks ask about roles rather than comparing a rank.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  [OrgRole.guest]: 0,
  [OrgRole.member]: 1,
  [OrgRole.admin]: 2,
  [OrgRole.co_owner]: 3,
  [OrgRole.owner]: 4,
};

/** True when `role` carries at least the authority of `minimum`. */
export function roleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

/**
 * True when `role` may manage an organization: update its details, its members,
 * and its teams. Deletion is narrower and requires `owner` specifically.
 */
export function canAdminister(role: OrgRole): boolean {
  return roleAtLeast(role, OrgRole.admin);
}

export function isValidEnumValue<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
