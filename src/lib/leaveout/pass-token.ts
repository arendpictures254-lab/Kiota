/**
 * The gate pass token in the QR code. It carries no student details, only:
 *
 *   KP1.<school id>.<leave-out id>.<nonce>.<signature>     (base64url, about 140 characters)
 *
 * The signature is Ed25519 over everything before it, made with the school's private key on the
 * server. A gate device holds only the school's public key, so it can check a pass offline (Web
 * Crypto) but never make one, and a pass from another school fails against its key.
 *
 * Isomorphic: runs in the browser (the gate screen) and on the server (tests, online checks).
 */

const PREFIX = "KP1";

export type PassToken = {
  schoolId: string;
  leaveoutId: string;
  nonce: string;
  signed: string;
  signature: string;
};

function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function uuidToB64u(id: string): string {
  const h = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(h)) throw new Error("not a uuid");
  return toB64u(Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))));
}

function b64uToUuid(text: string): string | null {
  try {
    const b = fromB64u(text);
    if (b.length !== 16) return null;
    const h = hex(b);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  } catch {
    return null;
  }
}

/** The part of a token that is signed (everything before the signature). */
export function passMessage(schoolId: string, leaveoutId: string, nonce: string): string {
  return `${PREFIX}.${uuidToB64u(schoolId)}.${uuidToB64u(leaveoutId)}.${nonce}`;
}

export function encodePass(message: string, signature: Uint8Array): string {
  return `${message}.${toB64u(signature)}`;
}

export function randomNonce(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return toB64u(b);
}

/** Read a token (no checking yet). Null if it is not a Kiota pass at all. */
export function parsePass(token: string): PassToken | null {
  const parts = token.trim().split(".");
  if (parts.length !== 5 || parts[0] !== PREFIX) return null;
  const schoolId = b64uToUuid(parts[1]);
  const leaveoutId = b64uToUuid(parts[2]);
  if (!schoolId || !leaveoutId || !/^[A-Za-z0-9_-]{8,24}$/.test(parts[3])) return null;
  if (!/^[A-Za-z0-9_-]{80,90}$/.test(parts[4])) return null;
  return {
    schoolId,
    leaveoutId,
    nonce: parts[3],
    signed: parts.slice(0, 4).join("."),
    signature: parts[4],
  };
}

/**
 * Check a pass's signature with the school's public key (raw 32 bytes, base64url).
 * "unsupported": this browser has no Ed25519 in Web Crypto (very old Chrome); the gate then
 * relies on the pass being in the list it downloaded from the server.
 */
export async function verifyPass(
  token: string,
  publicKey: string,
): Promise<"valid" | "invalid" | "unsupported"> {
  const p = parsePass(token);
  if (!p) return "invalid";
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", fromB64u(publicKey), { name: "Ed25519" }, false, [
      "verify",
    ]);
  } catch {
    return "unsupported";
  }
  try {
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      fromB64u(p.signature),
      new TextEncoder().encode(p.signed),
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

/** SHA-256 of "<leave-out id>:<pickup code>": the gate checks the collector's code offline. */
export async function pickupCodeHash(leaveoutId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${leaveoutId}:${code.trim()}`),
  );
  return hex(new Uint8Array(digest));
}
