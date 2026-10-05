import { createHash } from 'node:crypto';

/**
 * Ethereum message hashing.
 *
 * `keccak256` and the EIP-191 personal-sign prefix are implemented here because
 * Node's crypto exposes neither under a portable name — its 'sha3-256' is
 * NIST SHA-3, which differs from Keccak-256 in padding and would recover the
 * wrong address for every signature.
 *
 * **Signature recovery is not implemented.** Recovering a signer's public key
 * from an ECDSA signature needs secp256k1 point arithmetic, and no secp256k1
 * library is installed (the sandbox has no network egress to add one). Writing
 * that by hand would mean a few hundred lines of security-critical elliptic
 * curve code whose failure mode is accepting a forged signature — so it is
 * absent, and `recoverSigner` reports that plainly rather than returning a
 * guess.
 *
 * Everything that does not need recovery is complete: keccak256, the EIP-191
 * prefix, address normalisation, and signature format validation. Adding
 * `ethers` or `@noble/curves` on the host and wiring it into `setRecoveryFn`
 * below is the whole of what is missing. See the task record.
 */

// --- keccak256 -------------------------------------------------------------

const KECCAK_ROUNDS = 24;
const RATE = 136; // 1088 bits, the parameter set Ethereum uses
const STATE_LANES = 25;
const UINT64 = 0xffffffffffffffffn;

const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTATION_OFFSETS: readonly bigint[] = [
  0n, 1n, 62n, 28n, 27n,
  36n, 44n, 6n, 55n, 20n,
  3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n, 8n,
  18n, 2n, 61n, 56n, 14n,
];

function rotl64(value: bigint, shift: bigint): bigint {
  const s = shift & 63n;
  if (s === 0n) return value;
  return ((value << s) | (value >> (64n - s))) & UINT64;
}

function keccakF1600(state: bigint[]): void {
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    // theta
    const c = new Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x++) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    }
    const d = new Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5]! ^ rotl64(c[(x + 1) % 5]!, 1n);
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] = (state[x + 5 * y]! ^ d[x]!) & UINT64;
      }
    }

    // rho and pi combined — each lane is rotated then moved to its pi position.
    const b = new Array<bigint>(STATE_LANES).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y]!, ROTATION_OFFSETS[x + 5 * y]!);
      }
    }

    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        state[x + 5 * y] =
          (b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & UINT64) & b[((x + 2) % 5) + 5 * y]!) &
          UINT64;
      }
    }

    // iota
    state[0] = (state[0]! ^ ROUND_CONSTANTS[round]!) & UINT64;
  }
}

/**
 * Keccak-256, as Ethereum uses it.
 *
 * Padding uses the original Keccak domain byte 0x01, not SHA-3's 0x06.
 */
export function keccak256(message: Buffer): Buffer {
  const state = new Array<bigint>(STATE_LANES).fill(0n);

  const padded = Buffer.alloc(Math.ceil((message.length + 1) / RATE) * RATE);
  message.copy(padded);
  padded[message.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1]! | 0x80) & 0xff;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      state[lane] = (state[lane]! ^ padded.readBigUInt64LE(offset + lane * 8)) & UINT64;
    }
    keccakF1600(state);
  }

  // One squeeze block suffices: 136 bytes of output available, 32 needed.
  const output = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    output[i] = Number((state[Math.floor(i / 8)]! >> BigInt((i % 8) * 8)) & 0xffn);
  }
  return output;
}

// --- EIP-191 ---------------------------------------------------------------

/**
 * The personal-sign prefix. Without it a signature covers the bare digest, which
 * means a signature minted for one protocol replays in another.
 */
const PERSONAL_PREFIX = 'Ethereum Signed Message:\n';

export function personalMessageHash(message: string): Buffer {
  const payload = Buffer.from(message, 'utf8');
  const framed = Buffer.concat([
    Buffer.from(PERSONAL_PREFIX, 'utf8'),
    Buffer.from(String(payload.length), 'utf8'),
    payload,
  ]);
  return keccak256(framed);
}

export function typedDataHash(domain: {
  name: string;
  version: string;
  chainId: number;
  verifyingContract?: string;
}): Buffer {
  const typeHash = keccak256(
    Buffer.from(
      'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
      'utf8',
    ),
  );

  return keccak256(
    Buffer.concat([
      typeHash,
      keccak256(Buffer.from(domain.name, 'utf8')),
      keccak256(Buffer.from(domain.version, 'utf8')),
      bigIntTo32Bytes(BigInt(domain.chainId)),
      domain.verifyingContract ? addressTo32Bytes(domain.verifyingContract) : Buffer.alloc(32),
    ]),
  );
}

function bigIntTo32Bytes(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function addressTo32Bytes(address: string): Buffer {
  const clean = address.startsWith('0x') ? address.slice(2) : address;
  return Buffer.from(clean.padStart(64, '0'), 'hex');
}

// --- addresses -------------------------------------------------------------

/** Lowercase 0x form, or null when the input is not a 20-byte hex address. */
export function normalizeAddress(address: string): string | null {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  return address.toLowerCase();
}

// --- signature verification ------------------------------------------------

export interface SignatureParts {
  r: string;
  s: string;
  /** 0 or 1. A 64-byte signature has no recovery id and cannot identify a key. */
  recovery: number;
}

export interface SignatureFormatResult {
  valid: boolean;
  parts: SignatureParts | null;
  reason?: string;
}

/**
 * Validates signature shape without verifying it.
 *
 * Separated from verification so a malformed signature is rejected before any
 * expensive work, and so callers can tell "malformed" from "well-formed but not
 * verifiable here".
 */
export function parseSignature(signature: string): SignatureFormatResult {
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature;

  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return { valid: false, parts: null, reason: 'Signature must be hex.' };
  }

  if (hex.length === 128) {
    return {
      valid: false,
      parts: null,
      reason:
        'A 64-byte signature carries no recovery id, so it cannot identify which key signed. Request a 65-byte signature.',
    };
  }

  if (hex.length !== 130) {
    return { valid: false, parts: null, reason: 'Signature must be 65 bytes (r, s, v).' };
  }

  const recovery = Number.parseInt(hex.slice(128, 130), 16);
  if (recovery !== 0 && recovery !== 1) {
    return { valid: false, parts: null, reason: 'Recovery id must be 0 or 1.' };
  }

  const r = hex.slice(0, 64);
  const s = hex.slice(64, 128);

  // secp256k1's group order. An r or s at or above it is not a valid signature,
  // and accepting one would be a malleability weakness.
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  if (BigInt(`0x${r}`) >= order || BigInt(`0x${s}`) >= order) {
    return { valid: false, parts: null, reason: 'Signature r or s is outside the curve order.' };
  }

  // EIP-2 requires s to be in the lower half of the order, so a signature has
  // exactly one valid form.
  const halfOrder = order >> 1n;
  if (BigInt(`0x${s}`) > halfOrder) {
    return {
      valid: false,
      parts: null,
      reason: 'Signature s value is not canonical (EIP-2 requires the lower half of the curve order).',
    };
  }

  return { valid: true, parts: { r, s, recovery } };
}

/** Recovers the signing address from a digest. Injected, absent by default. */
export type RecoveryFn = (digest: Buffer, parts: SignatureParts) => string | null;

let recoveryFn: RecoveryFn | null = null;

/**
 * Installs a public-key recovery implementation.
 *
 * Called once at boot by whichever secp256k1 library the deployment uses. Until
 * then `recoverSigner` returns null and web3 login refuses, which is the correct
 * behaviour: a build that cannot verify a signature must not accept one.
 */
export function setRecoveryFn(fn: RecoveryFn | null): void {
  recoveryFn = fn;
}

export function isRecoveryAvailable(): boolean {
  return recoveryFn !== null;
}

export function recoverSigner(digest: Buffer, parts: SignatureParts): string | null {
  if (!recoveryFn) return null;
  try {
    const address = recoveryFn(digest, parts);
    return address ? normalizeAddress(address) : null;
  } catch {
    // A throwing recovery function is a failure to verify, never a pass.
    return null;
  }
}

export interface VerifyResult {
  valid: boolean;
  recovered: string | null;
  reason?: string;
}

/**
 * Verifies a personal-sign signature against an address.
 *
 * Returns `valid: false` with an explanatory `reason` when recovery is not
 * installed. Callers surface that reason, so the failure reads as "not
 * available in this deployment" rather than as "wrong signature" — the
 * distinction matters when someone is trying to work out why their wallet login
 * is refused.
 */
export function verifyPersonalSignature(
  address: string,
  message: string,
  signature: string,
): VerifyResult {
  const expected = normalizeAddress(address);
  if (!expected) {
    return { valid: false, recovered: null, reason: 'Address is not a valid 20-byte hex value.' };
  }

  const parsed = parseSignature(signature);
  if (!parsed.valid || !parsed.parts) {
    return { valid: false, recovered: null, reason: parsed.reason };
  }

  if (!recoveryFn) {
    return {
      valid: false,
      recovered: null,
      reason:
        'Signature verification is not available in this deployment: no secp256k1 recovery implementation is installed.',
    };
  }

  const digest = personalMessageHash(message);
  const recovered = recoverSigner(digest, parsed.parts);

  if (!recovered) {
    return { valid: false, recovered: null, reason: 'Signature does not recover a public key.' };
  }

  const valid = recovered === expected;
  return {
    valid,
    recovered,
    ...(valid ? {} : { reason: 'Signature was produced by a different key.' }),
  };
}

/**
 * The message a wallet is asked to sign.
 *
 * Domain-separated so a signature collected for a login cannot be replayed as a
 * wallet-binding signature, or against a different deployment.
 */
export function buildAuthMessage(params: {
  domain: string;
  nonce: string;
  address: string;
  chain: string;
  issuedAt: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Authorize this login. This does not cost any gas.',
    '',
    `URI: ${params.domain}/auth/web3`,
    'Version: 1',
    `Chain ID: ${params.chain}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
  ].join('\n');
}

/**
 * The message a wallet is asked to sign in order to be bound.
 *
 * Carries the account id and a single-use nonce, both of which are load-bearing.
 * Without the account id a signature captured on one account could be replayed
 * to bind the wallet to another; without the nonce it could be replayed against
 * the same account for as long as it stayed valid.
 */
export function buildWalletBindMessage(params: {
  domain: string;
  address: string;
  chain: string;
  accountId: number;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${params.domain} — bind wallet`,
    '',
    `Address: ${params.address}`,
    `Chain: ${params.chain}`,
    `Account: ${params.accountId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    '',
    'This binds the wallet to the account. It does not cost any gas.',
  ].join('\n');
}

/** sha256 for the opaque-token path. Distinct from keccak256 by design. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
