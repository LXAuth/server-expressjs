import { z } from "zod";
import { notFound } from "./errors.js";
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
