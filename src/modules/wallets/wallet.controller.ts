import type { Request, Response } from 'express';
import * as service from './wallet.service.js';
import {
  bindNonceSchema,
  bindWalletSchema,
  type BindNonceInput,
  type BindWalletInput,
} from './wallet.schemas.js';
import { requireActor } from '../../middleware/authenticate.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Wallet handlers, mounted at `/api/v1/accounts/:account_id/wallets`.
 *
 * The account id is in the path, so every handler resolves it and then asks
 * `requireWalletAdmin` whether the caller may act on it. That check lives in one
 * place — a per-handler version would eventually be missed on the fifth route.
 */

function parseAccountId(req: Request): number {
  const id = Number.parseInt(String(req.params.account_id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('account_id must be a positive integer.');
  }
  return id;
}

function parseWalletId(req: Request): number {
  const id = Number.parseInt(String(req.params.wallet_id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('wallet_id must be a positive integer.');
  }
  return id;
}

/** `POST /accounts/{account_id}/wallets/nonce` */
export async function nonce(req: Request, res: Response): Promise<void> {
  const accountId = parseAccountId(req);
  const actor = requireActor(req);
  await service.requireWalletAdmin(actor.accountId, accountId);

  const parsed = bindNonceSchema.parse(req.body as BindNonceInput);
  const issued = await service.issueBindNonce(accountId, parsed.chain, parsed.address);

  res.status(201).json(issued);
}

/** `POST /accounts/{account_id}/wallets/bind` */
export async function bind(req: Request, res: Response): Promise<void> {
  const accountId = parseAccountId(req);
  const actor = requireActor(req);
  await service.requireWalletAdmin(actor.accountId, accountId);

  const parsed = bindWalletSchema.parse(req.body as BindWalletInput);
  const wallet = await service.bindWallet(
    accountId,
    parsed.chain,
    parsed.address,
    parsed.nonce,
    parsed.signature,
  );

  res.status(201).json(wallet);
}

/** `GET /accounts/{account_id}/wallets` */
export async function list(req: Request, res: Response): Promise<void> {
  const accountId = parseAccountId(req);
  const actor = requireActor(req);
  await service.requireWalletAdmin(actor.accountId, accountId);

  const wallets = await service.listWallets(accountId);
  res.status(200).json({ wallets });
}

/** `PUT /accounts/{account_id}/wallets/{wallet_id}/primary` */
export async function setPrimary(req: Request, res: Response): Promise<void> {
  const accountId = parseAccountId(req);
  const actor = requireActor(req);
  await service.requireWalletAdmin(actor.accountId, accountId);

  const result = await service.setPrimaryWallet(accountId, parseWalletId(req));
  res.status(200).json(result);
}

/** `DELETE /accounts/{account_id}/wallets/{wallet_id}` */
export async function unbind(req: Request, res: Response): Promise<void> {
  const accountId = parseAccountId(req);
  const actor = requireActor(req);
  await service.requireWalletAdmin(actor.accountId, accountId);

  await service.unbindWallet(accountId, parseWalletId(req));
  res.status(204).send();
}