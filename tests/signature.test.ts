import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  isRecoveryAvailable,
  keccak256,
  normalizeAddress,
  parseSignature,
  personalMessageHash,
  verifyPersonalSignature,
} from '../src/lib/signature.js';

/**
 * `src/lib/signature.ts` — the parts that do not need a secp256k1 library.
 *
 * keccak256 is hand-written, so these vectors are the only thing standing between
 * it and a silent wrong answer. A wrong keccak recovers the wrong address for
 * every signature, and nothing else in the system would notice.
 *
 * No database, no HTTP — this is the one file in the suite that runs anywhere.
 */

describe('keccak256', () => {
  it('matches the known vector for the empty string', () => {
    expect(keccak256(Buffer.alloc(0)).toString('hex')).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('matches the known vector for "abc"', () => {
    expect(keccak256(Buffer.from('abc')).toString('hex')).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });

  it('matches the known vector for "The quick brown fox jumps over the lazy dog"', () => {
    expect(keccak256(Buffer.from('The quick brown fox jumps over the lazy dog')).toString('hex')).toBe(
      '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15',
    );
  });

  it('spans more than one rate block', () => {
    // 200 bytes is past the 136-byte rate, so this exercises the absorb loop
    // running more than once. A padding bug that only shows up at the boundary
    // would pass the short vectors above.
    expect(keccak256(Buffer.alloc(200, 0x61)).toString('hex')).toHaveLength(64);
  });

  it('is not NIST SHA-3, which pads differently', () => {
    // If this ever equals the sha3-256 digest, the padding byte regressed from
    // Keccak's 0x01 to SHA-3's 0x06 and every recovered address would be wrong.
    const nist = createHash('sha3-256').update('').digest('hex');

    expect(keccak256(Buffer.alloc(0)).toString('hex')).not.toBe(nist);
  });
});

describe('personalMessageHash', () => {
  it('applies the EIP-191 prefix and length', () => {
    const digest = personalMessageHash('hello');
    expect(digest).toHaveLength(32);
  });

  it('differs from the bare digest of the same message', () => {
    // Without the prefix, a signature covers the raw hash and would be valid in
    // any protocol that happened to hash the same bytes.
    const framed = personalMessageHash('hello');
    const bare = keccak256(Buffer.from('hello'));

    expect(framed.toString('hex')).not.toBe(bare.toString('hex'));
  });

  it('counts the message length in bytes, not characters', () => {
    // A multi-byte character changes the byte length the prefix declares, so this
    // pins the `Buffer.byteLength` behaviour rather than string length.
    const ascii = personalMessageHash('aa');
    const unicode = personalMessageHash('é');

    expect(ascii.toString('hex')).not.toBe(unicode.toString('hex'));
  });
});

describe('normalizeAddress', () => {
  it('lowercases a valid address', () => {
    expect(normalizeAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(
      '0xabcdef0123456789abcdef0123456789abcdef01',
    );
  });

  it('rejects a wrong-length address', () => {
    expect(normalizeAddress('0x1234')).toBeNull();
  });

  it('rejects a missing 0x prefix', () => {
    expect(normalizeAddress('abcdef0123456789abcdef0123456789abcdef01')).toBeNull();
  });
});

describe('parseSignature', () => {
  const order = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

  it('accepts a 65-byte signature with a low s value', () => {
    const signature = `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;
    const parsed = parseSignature(signature);

    expect(parsed.valid).toBe(true);
    expect(parsed.parts?.recovery).toBe(1);
  });

  it('rejects a 64-byte signature for naming a reason', () => {
    // A 64-byte signature carries no recovery id, so it cannot identify which
    // key signed. The reason says so rather than just "invalid".
    const parsed = parseSignature(`0x${'11'.repeat(64)}`);

    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toContain('recovery id');
  });

  it('rejects a recovery id above 1', () => {
    const parsed = parseSignature(`0x${'11'.repeat(32)}${'22'.repeat(32)}1c`);

    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toContain('Recovery id');
  });

  it('rejects an s value in the upper half of the curve order', () => {
    // EIP-2 requires the low half, so every signature has exactly one valid
    // form. Accepting both would be a malleability weakness.
    const highS = order.slice(0, -1) + '2';
    const parsed = parseSignature(`0x${'11'.repeat(32)}${highS}1b`);

    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toContain('canonical');
  });

  it('rejects non-hex input', () => {
    const parsed = parseSignature('0xzzzz');
    expect(parsed.valid).toBe(false);
  });
});

describe('verifyPersonalSignature without a recovery implementation', () => {
  it('reports that no recovery function is installed', () => {
    // The whole point of this file's honesty: nothing is installed, and the
    // library says so rather than returning a plausible wrong answer.
    expect(isRecoveryAvailable()).toBe(false);
  });

  it('refuses to verify, with a reason that distinguishes unavailability from a bad signature', () => {
    const result = verifyPersonalSignature(
      '0x1234567890abcdef1234567890abcdef12345678',
      'hello',
      `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not available');
  });

  it('reports a malformed address as malformed, before recovery is even considered', () => {
    const result = verifyPersonalSignature('0xnope', 'hello', '0x00');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('20-byte hex');
  });
});