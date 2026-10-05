import { Router } from 'express';
import * as controller from './wallet.controller.js';
import { authenticate } from '../../middleware/authenticate.js';

/**
 * Wallet routes, mounted at `/api/v1/accounts/:account_id/wallets`.
 *
 * `authenticate` runs for the whole router. Authorization is per-account and
 * lives in `requireWalletAdmin`, because `wallets.account_id` points at
 * `accounts` — which is polymorphic — so "may this caller act here?" cannot be
 * answered from the token alone.
 */
export function walletRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.use(authenticate);

  router.post('/nonce', controller.nonce);
  router.post('/bind', controller.bind);
  router.get('/', controller.list);
  router.put('/:wallet_id/primary', controller.setPrimary);
  router.delete('/:wallet_id', controller.unbind);

  return router;
}