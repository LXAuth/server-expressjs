import { Router } from 'express';
import * as controller from './membership.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * Membership routes, mounted at `/api/v1/accounts/:account_id/membership`.
 *
 * Every route is authenticated. Authorization is per-account and lives in the
 * service, because `account_memberships.account_id` is polymorphic for the same
 * reason `wallets.account_id` is.
 */
export function membershipRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.get('/', controller.get);
  router.post('/upgrade', controller.upgrade);

  return router;
}