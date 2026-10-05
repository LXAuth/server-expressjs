import type { Request, Response } from 'express';
import * as service from './team.service.js';
import {
  addTeamMemberSchema,
  createTeamSchema,
  listTeamsSchema,
  updateTeamSchema,
  type AddTeamMemberInput,
  type CreateTeamInput,
  type UpdateTeamInput,
} from './team.schemas.js';
import { requireActor } from '../../middleware/authenticate.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Team handlers. Mounted under an existing organization router, so
 * `authenticate` has already run by the time these are reached.
 */

function parseId(req: Request, param: string, label: string): number {
  const id = Number.parseInt(String(req.params[param]), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest(`${label} must be a positive integer.`);
  }
  return id;
}

/** `GET /organizations/{org_id}/teams` */
export async function list(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = listTeamsSchema.parse(req.query);
  const result = await service.listTeams(parseId(req, 'org_id', 'org_id'), actor.accountId, parsed);
  res.status(200).json(result);
}

/** `GET /organizations/{org_id}/teams/{team_id}` */
export async function get(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const team = await service.getTeam(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    actor.accountId,
  );
  res.status(200).json(team);
}

/** `POST /organizations/{org_id}/teams` */
export async function create(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = createTeamSchema.parse(req.body as CreateTeamInput);
  const team = await service.createTeam(parseId(req, 'org_id', 'org_id'), actor.accountId, parsed);
  res.status(201).json(team);
}

/** `PUT /organizations/{org_id}/teams/{team_id}` */
export async function update(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = updateTeamSchema.parse(req.body as UpdateTeamInput);
  const team = await service.updateTeam(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    actor.accountId,
    parsed,
  );
  res.status(200).json(team);
}

/** `DELETE /organizations/{org_id}/teams/{team_id}` */
export async function remove(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  await service.deleteTeam(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    actor.accountId,
  );
  res.status(204).send();
}

/** `GET /organizations/{org_id}/teams/{team_id}/members` */
export async function listMembers(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const members = await service.listTeamMembers(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    actor.accountId,
  );
  res.status(200).json({ members });
}

/** `POST /organizations/{org_id}/teams/{team_id}/members` */
export async function addMember(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  const parsed = addTeamMemberSchema.parse(req.body as AddTeamMemberInput);
  const result = await service.addTeamMember(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    actor.accountId,
    parsed,
  );
  res.status(201).json(result);
}

/** `DELETE /organizations/{org_id}/teams/{team_id}/members/{user_id}` */
export async function removeMember(req: Request, res: Response): Promise<void> {
  const actor = requireActor(req);
  await service.removeTeamMember(
    parseId(req, 'org_id', 'org_id'),
    parseId(req, 'team_id', 'team_id'),
    parseId(req, 'user_id', 'user_id'),
    actor.accountId,
  );
  res.status(204).send();
}
