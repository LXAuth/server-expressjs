import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { userRoutes } from '../modules/users/user.routes.js';
import { organizationRoutes } from '../modules/organizations/organization.routes.js';

/**
 * The single mount point for every route, under `/api/v1`.
 *
 * Each module exports its own router and is mounted here, so the route table
 * can be read in one place. Modules are added as they land — tasks 4 through 9
 * each add one line.
 */
export function registerRoutes(): Router {
  const router = Router();

  router.use('/auth', authRoutes());
  router.use('/users', userRoutes());
  router.use('/organizations', organizationRoutes());

  // router.use('/accounts', accountRoutes)  // tasks 8 and 9

  return router;
}
