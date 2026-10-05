import { z } from 'zod';

/**
 * Request schemas for the teams group.
 *
 * A team's own `role` column is a free-text VARCHAR(50) in the specified DDL,
 * not an enum, so unlike organization roles there is no `src/lib/enums.ts` set to
 * validate against. It is constrained to the two obvious values here and
 * defaults to `member`.
 */

const TEAM_ROLES = ['member', 'lead'] as const;

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const updateTeamSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const addTeamMemberSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(TEAM_ROLES).default('member'),
});

export const listTeamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type ListTeamsInput = z.infer<typeof listTeamsSchema>;
