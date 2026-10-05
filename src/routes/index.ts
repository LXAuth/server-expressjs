import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { userRoutes } from '../modules/users/user.routes.js';
import { organizationRoutes } from '../modules/organizations/organization.routes.js';
import { walletRoutes } from '../modules/wallets/wallet.routes.js';

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

  // Wallets hang off an account rather than a user, since `wallets.account_id`
  // is polymorphic — a user, an organization, or an agent. That is why the mount
  // point is `/accounts/{account_id}` and not under `/users`.
  router.use('/accounts/:account_id/wallets', walletRoutes());

  // router.use('/accounts/:account_id/membership', membershipRoutes)  // task 9

  return router;
}
