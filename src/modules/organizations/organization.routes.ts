import { Router } from 'express';
import * as controller from './organization.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * Organization routes, mounted at `/api/v1/organizations`.
 *
 * Teams are mounted under the same prefix by task 7 and must be registered
 * before the `/:org_id` routes below would match — otherwise `/:org_id` would
 * swallow `/12/teams`. Express matches in declaration order, so the more
 * specific path has to come first.
 */
export function organizationRoutes(): Router {
  const router = Router();

  // router.use('/:org_id/teams', teamRoutes());  // task 7, declared first

  router.use(authenticate);

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
