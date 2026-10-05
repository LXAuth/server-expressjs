import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Opaque token generation and hashing.
 *
 * Refresh tokens, invite tokens, and email-verification tokens all follow the
 * same rule: the caller gets the secret once, and only its hash is stored. A
 * stolen database then yields nothing usable — an attacker who reads
 * `token_hash` still cannot present it, because the server hashes whatever it is
 * given before comparing.
 *
 * The pepper is mixed in with the same reasoning. Without it, a hash of a
 * 32-byte random value is not brute-forceable, but a pepper means a database
 * dump alone is useless even if the token space were ever weakened. Rotating
 * `TOKEN_PEPPER` invalidates every outstanding session and invite at once,
 * which is the intended response to a compromise.
 */

/** A token as handed to the client. Never stored. */
export type RawToken = string;

/**
 * 32 bytes of CSPRNG output, base64url encoded. base64url rather than hex
 * because the token travels in a URL and JSON, and this alphabet needs no
 * escaping in either.
 */
export function generateToken(bytes = 32): RawToken {
  return randomBytes(bytes).toString('base64url');
}

/**
 * The value stored in the database. Deterministic, so lookup by hash is an
 * equality match rather than a scan-and-compare over every row.
 */
export function hashToken(token: RawToken): string {
  return createHash('sha256')
    .update(`${config.tokens.pepper}:${token}`)
    .digest('hex');
}

/**
 * Constant-time comparison for two hashes.
 *
 * Only used where both sides are already known, so this is defence in depth
 * rather than the primary defence — the primary is that lookups are by hash, so
 * no comparison against a secret happens on the hot path at all.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');

  // timingSafeEqual throws on a length mismatch, which would itself leak length
  // through the exception. Compare lengths first, then the contents.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** A family id groups every token descended from one login. */
export function generateFamilyId(): string {
  return randomBytes(16).toString('base64url');
}

/** A nonce for the web3 handshake. 16 bytes is ample for single use. */
export function generateNonce(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
