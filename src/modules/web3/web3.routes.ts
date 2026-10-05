import { Router } from 'express';
import * as controller from './web3.controller.js';

/**
 * Web3 login routes, mounted at `/api/v1/auth/web3`.
 *
 * Both are unauthenticated. The sequence is `/nonce` then `/login`, and neither
 * carries a bearer token — a wallet signing in has nothing to authenticate with
 * yet, which is the entire reason this handshake exists.
 */
export function web3Routes(): Router {
  const router = Router();

  router.post('/nonce', controller.nonce);
  router.post('/login', controller.login);

  return router;
}