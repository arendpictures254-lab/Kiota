/**
 * Secrets at rest (M-Pesa credentials): AES-256-GCM with a key from CREDENTIALS_ENCRYPTION_KEY
 * (64 hex characters = 32 bytes). Format: "v1:<iv>:<tag>:<ciphertext>" (base64url).
 * Losing the key means re-entering the credentials; never commit it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Not an encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** A random URL-safe secret (callback tokens). */
export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}
