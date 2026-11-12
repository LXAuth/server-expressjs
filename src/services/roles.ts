export const ORG_ROLES = ["owner", "co_owner", "admin", "member", "guest"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const RANK: Record<OrgRole, number> = { owner: 5, co_owner: 4, admin: 3, member: 2, guest: 1 };

export function rank(role: OrgRole): number {
  return RANK[role];
}

/** True when `actual` is at least as strong as `required`. */
export function atLeast(actual: OrgRole, required: OrgRole): boolean {
  return RANK[actual] >= RANK[required];
}
