import { z } from 'zod';

/**
 * Request schemas for the users group.
 */

const email = z.string().trim().toLowerCase().email().max(255);
const nameId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^@[a-z0-9_]{2,30}$/, 'Must be @ followed by 2-30 lowercase letters, digits, or underscores.');
const nameDisplay = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  email,
  password: z.string().min(12).max(256),
  nameId,
  nameDisplay: nameDisplay.optional(),
  /** A wallet address to bind at signup. Requires a signature, added in task 8. */
  walletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte hex address.')
    .optional(),
  signature: z.string().trim().max(1024).optional(),
});

export const updateMeSchema = z
  .object({
    nameDisplay: nameDisplay.optional(),
    avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

/**
 * No `isPrimary` here on purpose. An unverified address cannot be made
 * primary — see `setPrimaryEmail` — so accepting the flag would either lie to
 * the caller or need honouring later. Promotion is its own endpoint.
 */
export const addEmailSchema = z.object({
  email,
});

export const setPrimaryEmailSchema = z.object({
  emailId: z.number().int().positive(),
});

export const addAddressSchema = z.object({
  address: z.string().trim().min(1).max(255),
  isPrimary: z.boolean().default(false),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(512),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AddEmailInput = z.infer<typeof addEmailSchema>;
export type AddAddressInput = z.infer<typeof addAddressSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
