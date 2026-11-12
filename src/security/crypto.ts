import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A 256-bit random secret, base64url encoded, with a readable type prefix. */
export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

/**
 * SHA-256 is enough for server-generated secrets: they carry 256 bits of
 * entropy, so there is nothing to brute-force. Passwords use argon2id instead.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
