import type { Request, Response } from 'express';
import * as service from './membership.service.js';
import {
  upgradeMembershipSchema,
  type UpgradeMembershipInput,
} from './membership.schemas.js';
import { requireActor } from '../../middleware/authenticate.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Membership handlers, mounted at `/api/v1/accounts/:account_id/membership`.
 *
 * Both operate on the account in the path, and both delegate the authorization
 * question to the service.
 */

function parseAccountId(req: Request): number {
  const id = Number.parseInt(String(req.params.account_id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('account_id must be a positive integer.');
  }
  return id;
}

/** `GET /accounts/{account_id}/membership` */
export async function get(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const membership = await service.getMembership(actor.accountId, parseAccountId(req));
  res.status(200).json(membership);
}

/** `POST /accounts/{account_id}/membership/upgrade` */
export async function upgrade(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = upgradeMembershipSchema.parse(req.body as UpgradeMembershipInput);

  const membership = await service.upgradeMembership(
    actor.accountId,
    parseAccountId(req),
    parsed,
  );

  res.status(200).json(membership);
}