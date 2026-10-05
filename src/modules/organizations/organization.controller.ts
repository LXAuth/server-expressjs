import type { Request, Response } from 'express';
import * as service from './organization.service.js';
import {
  createOrganizationSchema,
  inviteMemberSchema,
  joinOrganizationSchema,
  listMembersSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
  type CreateOrganizationInput,
  type InviteMemberInput,
  type JoinOrganizationInput,
  type ListMembersInput,
  type UpdateMemberRoleInput,
  type UpdateOrganizationInput,
} from './organization.schemas.js';
import { requireActor } from '../../middleware/authenticate.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Organization handlers.
 *
 * `:org_id` and `:user_id` arrive as strings and are parsed once, here, so a
 * malformed id produces a 400 rather than a Prisma error three layers down.
 */

function parseOrgId(req: Request): number {
  const id = Number.parseInt(String(req.params.org_id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('org_id must be a positive integer.');
  }
  return id;
}

function parseUserId(req: Request): number {
  const id = Number.parseInt(String(req.params.user_id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('user_id must be a positive integer.');
  }
  return id;
}

/** `POST /organizations` */
export async function create(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = createOrganizationSchema.parse(req.body as CreateOrganizationInput);
  const organization = await service.createOrganization(actor.accountId, parsed);
  res.status(201).json(organization);
}

/** `GET /organizations/{org_id}` */
export async function get(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const organization = await service.getOrganization(parseOrgId(req), actor.accountId);
  res.status(200).json(organization);
}

/** `PUT /organizations/{org_id}` */
export async function update(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = updateOrganizationSchema.parse(req.body as UpdateOrganizationInput);
  const organization = await service.updateOrganization(
    parseOrgId(req),
    actor.accountId,
    parsed,
  );
  res.status(200).json(organization);
}

/** `DELETE /organizations/{org_id}` */
export async function remove(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  await service.deleteOrganization(parseOrgId(req), actor.accountId);
  res.status(204).send();
}

/**
 * `GET /organizations/{org_id}/members`
 *
 * The query is parsed from `req.query` rather than the body, so it goes through
 * zod's coercion — `?page=2` arrives as a string.
 */
export async function listMembers(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = listMembersSchema.parse(req.query);
  res.status(200).json(await service.listMembers(parseOrgId(req), actor.accountId, parsed));
}

/** `POST /organizations/{org_id}/members/invite` */
export async function invite(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = inviteMemberSchema.parse(req.body as InviteMemberInput);
  const result = await service.inviteMember(parseOrgId(req), actor.accountId, parsed);
  res.status(201).json(result);
}

/** `POST /organizations/{org_id}/members/join` */
export async function join(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = joinOrganizationSchema.parse(req.body as JoinOrganizationInput);
  const result = await service.joinOrganization(parseOrgId(req), actor.accountId, parsed);
  res.status(200).json({ joined: true, ...result });
}

/** `PUT /organizations/{org_id}/members/{user_id}/role` */
export async function updateMemberRole(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = updateMemberRoleSchema.parse(req.body as UpdateMemberRoleInput);
  const result = await service.updateMemberRole(
    parseOrgId(req),
    actor.accountId,
    parseUserId(req),
    parsed,
  );
  res.status(200).json(result);
}

/** `DELETE /organizations/{org_id}/members/{user_id}` */
export async function removeMember(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  await service.removeMember(parseOrgId(req), actor.accountId, parseUserId(req));
  res.status(204).send();
}
