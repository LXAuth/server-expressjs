import { z } from 'zod';
import { ORG_ROLES } from '../../lib/enums.js';

/**
 * Request schemas for the organizations group.
 */

const nameId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^@[a-z0-9_]{2,30}$/, 'Must be @ followed by 2-30 lowercase letters, digits, or underscores.');
const nameDisplay = z.string().trim().min(1).max(100);

/**
 * Validated against the enum value set rather than a literal union, because the
 * schema stores roles as strings and the values live in `src/lib/enums.ts`.
 * Keeping one source of truth means a role added there is accepted here without
 * a second edit.
 */
const orgRole = z.enum(ORG_ROLES as [string, ...string[]]);

/**
 * No `description` on either schema. The specified DDL gives an organization no
 * description column — only `organization_teams` has one — and the brief says the
 * 11 tables are not to be restructured. Accepting a field and discarding it would
 * be worse than refusing it, so it is simply not in the contract. Adding it means
 * a migration, which is the owner's call.
 */
export const createOrganizationSchema = z.object({
  nameId,
  nameDisplay: nameDisplay.optional(),
});

export const updateOrganizationSchema = z
  .object({
    nameDisplay: nameDisplay.optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  /**
   * `owner` is deliberately not offered. Ownership transfers by promotion of an
   * existing member, which goes through the partial unique index and cannot
   * produce two owners — inviting a second owner would.
   */
  role: orgRole.exclude(['owner']).default('member'),
});

export const joinOrganizationSchema = z.object({
  token: z.string().min(1).max(512),
});

export const updateMemberRoleSchema = z.object({
  role: orgRole,
});

export const listMembersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  role: orgRole.optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type JoinOrganizationInput = z.infer<typeof joinOrganizationSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type ListMembersInput = z.infer<typeof listMembersSchema>;
