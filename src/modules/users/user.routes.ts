import { Router } from 'express';
import * as controller from './user.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * User routes, mounted at `/api/v1/users`.
 *
 * `POST /` is the only unauthenticated route in the group — it is registration.
 * Everything else sits behind `authenticate`, which does not query the database;
 * the claims in the token are the authorization input.
 */
export function userRoutes(): Router {
  const router = Router();

  router.post('/', controller.register);

  // The `me` routes are declared before any `/:id` style route would be, so a
  // future parametrised path cannot shadow them.
  router.get('/me', authenticate, controller.getMe);
  router.put('/me', authenticate, controller.updateMe);
  router.put('/me/password', authenticate, controller.changePassword);
  router.get('/me/organizations', authenticate, controller.listMyOrganizations);

  router.get('/me/emails', authenticate, controller.listEmails);
  router.post('/me/emails', authenticate, controller.addEmail);
  router.post('/me/emails/verify', controller.verifyEmail);
  router.put('/me/emails/:email_id/primary', authenticate, controller.setPrimaryEmail);

  router.get('/me/addresses', authenticate, controller.listAddresses);
  router.post('/me/addresses', authenticate, controller.addAddress);

  return router;
}
