import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { generateNonce } from '../../lib/crypto.js';
import {
  buildAuthMessage,
  isRecoveryAvailable,
  normalizeAddress,
  verifyPersonalSignature,
} from '../../lib/signature.js';
import { conflict, notFound, signatureUnavailable, tokenInvalid, unauthorized } from '../../lib/errors.js';
import { assertAccountUsable } from '../../lib/claims.js';
import { issueTokenPair, type TokenPair } from '../auth/auth.service.js';
import { logger } from '../../lib/logger.js';

/**
 * The wallet login handshake.
 *
 * Three steps, and the order matters:
 *
 *   1. `POST /auth/web3/nonce`  — the server issues a single-use challenge
 *   2. the wallet signs it       — proves control of the key, costs nothing
 *   3. `POST /auth/web3/login`   — the server checks the signature, consumes the
 *                                  challenge, and issues tokens
 *
 * The nonce is what makes the signature safe. An Ethereum signature is valid
 * forever, so without a per-login challenge a signature captured anywhere — a
 * proxy log, a replayed request, a front-end that echoed it — would be a
 * permanent credential. Tying it to a fresh single-use value makes each
 * signature good for exactly one login.
 *
 * The single-use guarantee is `web3_nonces.consumed_at`, and the consume is a
 * conditional update rather than a read-then-write. Two concurrent requests
 * carrying the same valid signature produce one winner: the second matches no
 * row, because the first already set `consumed_at`.
 */

export interface IssuedNonce {
  nonce: string;
  chain: string;
  expiresAt: Date;
  /** The exact text the wallet must sign. Sent so the client cannot drift. */
  message: string;
}

/**
 * Refuses early when no signature could be verified anyway.
 *
 * Issuing a challenge the client will carry to a wallet only to reject it at the
 * far end turns a deployment gap into a confusing client-side bug report.
 */
function assertRecoveryAvailable(): void {
  if (!isRecoveryAvailable()) {
    throw signatureUnavailable(
      'Wallet sign-in is not available in this deployment: no secp256k1 recovery implementation is installed.',
    );
  }
}

/**
 * Issues a challenge for a wallet to sign.
 *
 * The nonce is stored in the clear rather than hashed, because it is looked up
 * by primary key and is only useful while unexpired. That is a deliberate
 * difference from the refresh, invite, and verification tokens: those are bearer
 * credentials and are hashed at rest, this one is not — it cannot be presented
 * on its own, since a signature over it is required.
 */
export async function issueNonce(
  chain: string,
  address: string | undefined,
): Promise<IssuedNonce> {
  assertRecoveryAvailable();

  const normalized = address ? normalizeAddress(address) : null;
  if (address && !normalized) {
    throw tokenInvalid('Address is not a valid 20-byte hex value.');
  }

  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + config.web3.nonceTtlSeconds * 1000);

  await prisma.web3_nonces.create({
    data: {
      nonce,
      chain,
      expiresAt,
      // `accountId` stays null for a login challenge: there is no account yet,
      // which is what makes this different from the bind challenge in
      // `wallets.service`.
    },
  });

  return {
    nonce,
    chain,
    expiresAt,
    message: buildAuthMessage({
      domain: config.web3.domain,
      nonce,
      address: normalized ?? 'unknown',
      chain,
      issuedAt: expiresAt.toISOString(),
    }),
  };
}

/**
 * Consumes a nonce, atomically.
 *
 * The `consumedAt: null` in the filter is the whole single-use guarantee. A
 * read-then-write would let two concurrent requests both observe an unconsumed
 * nonce and both proceed; making the consumed state part of the match condition
 * lets the database pick the winner instead of the application.
 *
 * `accountId` is always a value the caller already knows — `null` for a login
 * challenge, the account id for a bind — and it is matched rather than
 * optional. That is what stops a login challenge being redeemed as a bind
 * challenge, or the reverse.
 */
async function consumeNonce(
  nonce: string,
  chain: string,
  accountId: number | null,
): Promise<boolean> {
  const { count } = await prisma.web3_nonces.updateMany({
    where: {
      nonce,
      chain,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      accountId,
    },
    data: { consumedAt: new Date() },
  });

  return count === 1;
}

/** Loads a live challenge, or throws the one error that covers every reason. */
async function loadLiveChallenge(
  nonce: string,
  chain: string,
): Promise<{ expiresAt: Date; accountId: number | null }> {
  const challenge = await prisma.web3_nonces.findUnique({
    where: { nonce },
    select: { chain: true, accountId: true, expiresAt: true, consumedAt: true },
  });

  // Unknown nonce, wrong chain, expired, and already consumed are deliberately
  // one error. Distinguishing them would tell an attacker which part of a replay
  // attempt got them furthest.
  if (
    !challenge ||
    challenge.chain !== chain ||
    challenge.consumedAt !== null ||
    challenge.expiresAt.getTime() <= Date.now()
  ) {
    throw tokenInvalid('Nonce is not recognised, has expired, or has already been used.');
  }

  return { expiresAt: challenge.expiresAt, accountId: challenge.accountId };
}

/**
 * Checks the signature and returns a token pair.
 *
 * The signing address is recovered from the signature rather than trusted from
 * the request body. That ordering is the only one that proves anything: if the
 * claimed address were used to look up the account first, an attacker holding
 * any private key could name someone else's address and be logged in as them.
 */
export async function login(
  chain: string,
  claimedAddress: string,
  nonce: string,
  signature: string,
): Promise<{
  tokens: TokenPair;
  account: { accountId: number; address: string; type: string };
}> {
  assertRecoveryAvailable();

  const claimed = normalizeAddress(claimedAddress);
  if (!claimed) {
    throw tokenInvalid('Address is not a valid 20-byte hex value.');
  }

  const challenge = await loadLiveChallenge(nonce, chain);

  // A bind challenge carries an account id and a login challenge does not. If a
  // login accepted the other kind, anyone who obtained a bind challenge for one
  // account could present its signature here and be logged in as whatever wallet
  // that signature came from.
  if (challenge.accountId !== null) {
    throw tokenInvalid('Nonce is not recognised, has expired, or has already been used.');
  }

  // The message is rebuilt from stored state, not from anything the client sends
  // back. If the client could supply the message it signed, it could sign one
  // that binds nothing to this nonce.
  const message = buildAuthMessage({
    domain: config.web3.domain,
    nonce,
    address: claimed,
    chain,
    issuedAt: challenge.expiresAt.toISOString(),
  });

  const verified = verifyPersonalSignature(claimed, message, signature);
  if (!verified.valid) {
    // The nonce is deliberately left unconsumed. A failed signature does not
    // mean the challenge was forged — the caller may have signed with the wrong
    // account, or a wallet may have mangled the message. Burning it would turn
    // one mistake into a restart.
    throw unauthorized(verified.reason ?? 'Signature verification failed.');
  }

  const wallet = await prisma.wallets.findUnique({
    where: { walletAddress: claimed },
    select: {
      accountId: true,
      account: { select: { id: true, type: true, status: true } },
    },
  });

  // An unbound wallet means there is no account to log into. This is a different
  // failure from an invalid signature and says so, because the caller's next step
  // differs entirely: bind the wallet, rather than debug their signature.
  if (!wallet?.accountId || !wallet.account) {
    throw notFound('Wallet bound to an account');
  }

  if (!(await consumeNonce(nonce, chain, challenge.accountId))) {
    throw conflict('This nonce has already been used or has expired.');
  }

  assertAccountUsable(wallet.account.status);

  const tokens = await issueTokenPair(
    wallet.account.id,
    wallet.account.type,
    wallet.account.status,
    'web3',
  );

  logger.info('Web3 login succeeded', {
    accountId: wallet.account.id,
    address: claimed,
    chain,
  });

  return {
    tokens,
    account: {
      accountId: wallet.account.id,
      address: claimed,
      type: wallet.account.type,
    },
  };
}