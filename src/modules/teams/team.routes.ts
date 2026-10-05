import { Router } from 'express';
import * as controller from './team.controller.js';

/**
 * Team routes.
 *
 * Mounted at `/:org_id/teams` from the organization router, which has already
 * applied `authenticate`. Express matches in declaration order, so the
 * organization router must mount this before its own `/:org_id` routes or they
 * would swallow `/12/teams`.
 *
 * `:team_id` and `:user_id` are declared here and resolved by the controller —
 * these paths are relative to the mount point.
 */
export function teamRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', controller.list);
  router.post('/', controller.create);

  router.get('/:team_id', controller.get);
  router.put('/:team_id', controller.update);
  router.delete('/:team_id', controller.remove);

  router.get('/:team_id/members', controller.listMembers);
  router.post('/:team_id/members', controller.addMember);
  router.delete('/:team_id/members/:user_id', controller.removeMember);

  return router;
}
