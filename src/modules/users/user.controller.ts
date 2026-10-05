import type { Request, Response } from 'express';
import * as userService from './user.service.js';
import {
  addAddressSchema,
  addEmailSchema,
  changePasswordSchema,
  registerSchema,
  updateMeSchema,
  verifyEmailSchema,
  type AddAddressInput,
  type AddEmailInput,
  type ChangePasswordInput,
  type RegisterInput,
  type UpdateMeInput,
  type VerifyEmailInput,
} from './user.schemas.js';
import { requireActor } from '../../middleware/authenticate.js';

/**
 * User handlers.
 *
 * The actor comes from `requireActor`, never from the request body — there is no
 * path by which a caller can act on another account.
 */

/**
 * `POST /users` — register.
 *
 * Returns 201 with the verification token. In a deployment with a mail transport
 * this field would be absent and the token would only ever exist in an email;
 * here it is returned so a client can exercise the verification flow.
 */
export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.parse(req.body as RegisterInput);
  const result = await userService.register(parsed);

  res.status(201).json({
    accountId: result.accountId,
    verificationToken: result.verificationToken,
  });
}

/** `GET /users/me` */
export async function getMe(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  res.status(200).json(await userService.getMe(actor.accountId));
}

/** `PUT /users/me` */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = updateMeSchema.parse(req.body as UpdateMeInput);
  res.status(200).json(await userService.updateMe(actor.accountId, parsed));
}

/**
 * `PUT /users/me/password`
 *
 * The response says how many sessions remain rather than how many were killed,
 * because the caller's own current session is revoked too and it cannot use the
 * old token to find that out.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = changePasswordSchema.parse(req.body as ChangePasswordInput);
  const result = await userService.changePassword(actor.accountId, parsed);

  res.status(200).json({
    changed: true,
    sessionsRemaining: result.sessionsRevoked,
    message: 'Password changed. All existing sessions have been revoked.',
  });
}

/** `GET /users/me/organizations` */
export async function listMyOrganizations(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  res.status(200).json({ organizations: await userService.listMyOrganizations(actor.accountId) });
}

/** `GET /users/me/emails` */
export async function listEmails(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  res.status(200).json({ emails: await userService.listEmails(actor.accountId) });
}

/** `POST /users/me/emails` */
export async function addEmail(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = addEmailSchema.parse(req.body as AddEmailInput);
  const result = await userService.addEmail(actor.accountId, parsed);

  res.status(201).json({
    id: result.id,
    email: result.email,
    isVerified: false,
    verificationToken: result.verificationToken,
  });
}

/**
 * `POST /users/me/emails/verify`
 *
 * Not in the original path list. Verification has to be reachable somehow, and
 * with no mail transport in this build the token is handed back by the two
 * endpoints above — so the endpoint that consumes it has to exist too.
 */
export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const parsed = verifyEmailSchema.parse(req.body as VerifyEmailInput);
  const result = await userService.verifyEmail(parsed.token);
  res.status(200).json({ verified: true, email: result.email });
}

/** `PUT /users/me/emails/{email_id}/primary` */
export async function setPrimaryEmail(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const emailId = Number.parseInt(String(req.params.email_id), 10);

  if (!Number.isInteger(emailId) || emailId <= 0) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'email_id must be a positive integer.' },
    });
    return;
  }

  const result = await userService.setPrimaryEmail(actor.accountId, emailId);
  res.status(200).json({ emailId: result.emailId, isPrimary: true });
}

/** `GET /users/me/addresses` */
export async function listAddresses(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  res.status(200).json({ addresses: await userService.listAddresses(actor.accountId) });
}

/** `POST /users/me/addresses` */
export async function addAddress(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = addAddressSchema.parse(req.body as AddAddressInput);
  res.status(201).json(await userService.addAddress(actor.accountId, parsed));
}
