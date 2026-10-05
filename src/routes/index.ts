import { Router } from 'express';

/**
 * The single mount point for every route, under `/api/v1`.
 *
 * Each module exports its own router and is mounted here, so the route table
 * can be read in one place. Modules are added as they land — tasks 4 through 9
 * each add one line.
 */
export function registerRoutes(): Router {
  const router = Router();

  // Mounted per module:
  //   router.use('/auth',           authRoutes)           // task 4
  //   router.use('/users',          userRoutes)          // task 5
  //   router.use('/organizations', organizationRoutes)  // task 6
  //   router.use('/accounts',       accountRoutes)       // tasks 8 and 9

  return router;
}
