import type { Request, Response } from 'express';
import * as web3Service from './web3.service.js';
import { web3LoginSchema, web3NonceSchema, type Web3LoginInput, type Web3NonceInput } from './web3.schemas.js';
import { logger } from '../../lib/logger.js';

/**
 * Web3 auth handlers.
 *
 * `nonce` and `login` are unauthenticated — that is the point of a login
 * endpoint. Everything else in this group lives in the wallets module behind
 * `authenticate`.
 */

/**
 * `POST /auth/web3/nonce`
 *
 * Returns the exact message to sign. Sending the text means the client cannot
 * reconstruct it slightly differently, which is a class of bug that otherwise
 * shows up as a mysterious signature rejection.
 */
export async function nonce(req: Request, res: Response): Promise<void> {
  const parsed = web3NonceSchema.parse(req.body as Web3NonceInput);
  const issued = await web3Service.issueNonce(parsed.chain, parsed.address);
  res.status(201).json(issued);
}

/** `POST /auth/web3/login` */
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = web3LoginSchema.parse(req.body as Web3LoginInput);

  const { tokens, account } = await web3Service.login(
    parsed.chain,
    parsed.address,
    parsed.nonce,
    parsed.signature,
  );

  logger.info('Web3 login', { accountId: account.accountId });

  res.status(200).json({
    ...tokens,
    account: {
      accountId: account.accountId,
      address: account.address,
      type: account.type,
    },
  });
}
