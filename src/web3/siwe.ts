import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { randomBytes } from "node:crypto";

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 mixed-case checksum encoding, as EIP-4361 requires in the message. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().slice(2);
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i];
  }
  return out;
}

/** An alphanumeric nonce, at least 8 characters as EIP-4361 requires. */
export function siweNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface SiweFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Formats an EIP-4361 message. The server writes it; the wallet only signs it. */
export function buildSiweMessage(f: SiweFields): string {
  return [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    toChecksumAddress(f.address),
    "",
    f.statement,
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt.toISOString()}`,
    `Expiration Time: ${f.expiresAt.toISOString()}`,
  ].join("\n");
}

/** EIP-191 `personal_sign` digest. */
export function personalMessageHash(message: string): Uint8Array {
  const body = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${body.length}`);
  const joined = new Uint8Array(prefix.length + body.length);
  joined.set(prefix);
  joined.set(body, prefix.length);
  return keccak_256(joined);
}

/**
 * Recovers the lowercase address that produced a 65-byte `personal_sign`
 * signature (r ‖ s ‖ v). Returns `null` for anything malformed, including
 * high-S signatures, which EIP-2 rules out as malleable.
 */
export function recoverAddress(message: string, signatureHex: string): string | null {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) return null;
  try {
    const sig = hexToBytes(signatureHex.slice(2));
    const v = sig[64]!;
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) return null;
    const rs = sig.subarray(0, 64);
    if (secp256k1.Signature.fromBytes(rs, "compact").hasHighS()) return null;

    const recovered = new Uint8Array(65);
    recovered[0] = recovery;
    recovered.set(rs, 1);
    const publicKey = secp256k1.recoverPublicKey(recovered, personalMessageHash(message), { prehash: false });
    const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
    return `0x${bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(-20))}`;
  } catch {
    return null;
  }
}
