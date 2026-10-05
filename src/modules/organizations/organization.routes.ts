import { Router } from 'express';
import * as controller from './organization.controller.js';
import { teamRoutes } from '../teams/team.routes.js';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * Organization routes, mounted at `/api/v1/organizations`.
 */
export function organizationRoutes(): Router {
  const router = Router();

  router.use(authenticate);

  // Declared before the `/:org_id` routes below, because Express matches in
  // declaration order — `/:org_id` would otherwise swallow `/12/teams`.
  router.use('/:org_id/teams', teamRoutes());

  router.post('/', controller.create);
  router.get('/:org_id', controller.get);
  router.put('/:org_id', controller.update);
  router.delete('/:org_id', controller.remove);

  router.get('/:org_id/members', controller.listMembers);
  router.post('/:org_id/members/invite', controller.invite);
  router.post('/:org_id/members/join', controller.join);
  router.put('/:org_id/members/:user_id/role', controller.updateMemberRole);
  router.delete('/:org_id/members/:user_id', controller.removeMember);

  return router;
}
