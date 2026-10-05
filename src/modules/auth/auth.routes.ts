import { Router } from 'express';
import * as controller from './auth.controller.js';
import { web3Routes } from '../web3/web3.routes.js';

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

  // Unauthenticated, like `/login`: a wallet is signing in, so there is no token
  // to present yet.
  router.use('/web3', web3Routes());

  return router;
}
