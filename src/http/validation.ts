import { z } from "zod";
import { HttpError, notFound } from "./errors.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../security/passwords.js";

export const emailField = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

/** For checking an existing password: no policy, just a sane length cap. */
export const passwordField = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const emailTypeField = z.enum(["primary", "recovery", "notification", "receipt", "other"]);

export const redirectUriField = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((u) => !new URL(u).hash, "Redirect URI must not contain a fragment");

const uuid = z.uuid();

/** Route ids that are not well-formed are indistinguishable from unknown ones. */
export function uuidParam(value: string | string[] | undefined): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export const RegisterBody = z.strictObject({ email: emailField, password: newPasswordField });
export const LoginBody = z.strictObject({ email: emailField, password: passwordField });

export const CreateClientBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  redirect_uri: redirectUriField.nullable().optional(),
});
export const UpdateClientBody = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    redirect_uri: redirectUriField.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const AddEmailBody = z.strictObject({
  email: emailField,
  type: emailTypeField,
  login_enabled: z.boolean().default(false),
});
export const UpdateEmailBody = z
  .strictObject({ type: emailTypeField.optional(), login_enabled: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const ChangePasswordBody = z.strictObject({
  current_password: passwordField,
  new_password: newPasswordField,
});
export const DeleteAccountBody = z.strictObject({ password: passwordField });

export const nameIdField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9_-]{1,48}[a-z0-9])$/, "3–50 characters: a-z, 0-9, _ or -, not at either end");

export const UpdateProfileBody = z
  .strictObject({
    name_id: nameIdField.nullable().optional(),
    name_display: z.string().trim().min(1).max(100).nullable().optional(),
    avatar_url: z.url({ protocol: /^https$/ }).max(2048).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export const orgRoleField = z.enum(["owner", "co_owner", "admin", "member", "guest"]);

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, "3–50 characters: a-z, 0-9 or -, not at either end");

export const CreateOrganizationBody = z.strictObject({ slug: slugField, name: z.string().trim().min(1).max(100) });
export const UpdateOrganizationBody = z
  .strictObject({ slug: slugField.optional(), name: z.string().trim().min(1).max(100).optional() })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const ChangeRoleBody = z.strictObject({ role: orgRoleField });
export const TransferBody = z.strictObject({ account_id: z.uuid() });
export const CreateInviteBody = z.strictObject({
  role: orgRoleField.default("member"),
  email: emailField.optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});
export const AcceptInviteBody = z.strictObject({ invite_token: z.string().min(1).max(128) });

/** `?role=` on access checks. Absent means any membership at all. */
export function accessRoleQuery<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `role must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export const CreateTeamBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});
export const UpdateTeamBody = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const PutTeamMemberBody = z.strictObject({ role: z.enum(["lead", "member"]).default("member") });
