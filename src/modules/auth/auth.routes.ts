import { Router } from 'express';
import * as controller from './auth.controller.js';

/**
 * Auth and session routes, mounted at `/api/v1/auth`.
 *
 * `verify-token` is deliberately unauthenticated: it is the thing that
 * authenticates, so requiring a token to verify a token would be circular. Its
 * trust boundary is the shared secret — a caller who can reach it can read any
 * token's claims, which is the intended Zero Trust arrangement and the reason
 * it should not be exposed on a public interface.
 */
export function authRoutes(): Router {
  const router = Router();

  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/verify-token', controller.verifyToken);

  // The web3 handshake arrives in task 8:
  //   router.post('/web3/nonce', controller.web3Nonce);
  //   router.post('/web3/login', controller.web3Login);

  return router;
}
