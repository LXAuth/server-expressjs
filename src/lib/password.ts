import argon2 from 'argon2';
import { config } from '../config.js';

/**
 * Password hashing with argon2id.
 *
 * argon2id is the variant that resists both GPU cracking and side-channel
 * attacks, which is why it is the default rather than argon2i or argon2d. The
 * cost parameters are the OWASP baseline for argon2id: 19 MiB, 2 passes, 1 lane.
 *
 * Both parameters are read from config so they can be raised later without a
 * code change — and so an existing hash keeps verifying after a raise, because
 * argon2 stores its own parameters inside the hash string.
 */

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: config.argon2.memoryCost,
  timeCost: config.argon2.timeCost,
  parallelism: config.argon2.parallelism,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row should
 * deny access, not take down the login endpoint for every other user.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * True when a hash was made with weaker parameters than the current config, so
 * the caller can re-hash it on the user's next successful login. Upgrading a
 * hash only works if the plaintext is available at that moment, which is why
 * this is opportunistic rather than a migration.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/**
 * A length floor, not a composition rule. NIST SP 800-63B advises against
 * requiring a mix of character classes — it pushes people toward predictable
 * substitutions like `Password1!` — and instead favours length, a breach
 * check, and no forced rotation. There is no breach check here; the first two
 * are below.
 */
const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];

  if (password.length < MIN_LENGTH) {
    problems.push(`Must be at least ${MIN_LENGTH} characters.`);
  }
  // argon2 hashes the whole input, and an unbounded one is a cheap way to burn
  // server memory. 256 characters is far beyond any real passphrase.
  if (password.length > MAX_LENGTH) {
    problems.push(`Must be at most ${MAX_LENGTH} characters.`);
  }

  return { ok: problems.length === 0, problems };
}
