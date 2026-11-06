/**
 * The token in a student ID card's QR code. Like a gate pass it carries no student details, but
 * it has its own prefix, so a card is never mistaken for a pass (or a pass for a card):
 *
 *   KC1.<school id>.<card id>.<nonce>.<signature>
 *
 * Signed with the school's Ed25519 key. It names a card, not a purpose, so the gate, the tuck
 * shop and the library can all read it. Reissuing a card makes a new card id: the old token
 * then finds a revoked card.
 *
 * Isomorphic: the gate checks the signature in the browser; the server checks the card is live.
 */
import { b64uToUuid, fromB64u, toB64u, uuidToB64u } from "@/lib/leaveout/pass-token";

export const CARD_PREFIX = "KC1";

export type CardToken = {
  schoolId: string;
  cardId: string;
  nonce: string;
  signed: string;
  signature: string;
};

export function cardMessage(schoolId: string, cardId: string, nonce: string) {
  return `${CARD_PREFIX}.${uuidToB64u(schoolId)}.${uuidToB64u(cardId)}.${nonce}`;
}

export function encodeCard(message: string, signature: Uint8Array) {
  return `${message}.${toB64u(signature)}`;
}

export const isCardToken = (token: string) => token.trim().startsWith(`${CARD_PREFIX}.`);

export function parseCard(token: string): CardToken | null {
  const parts = token.trim().split(".");
  if (parts.length !== 5 || parts[0] !== CARD_PREFIX) return null;
  const schoolId = b64uToUuid(parts[1]);
  const cardId = b64uToUuid(parts[2]);
  if (!schoolId || !cardId || !/^[A-Za-z0-9_-]{8,24}$/.test(parts[3])) return null;
  if (!/^[A-Za-z0-9_-]{80,90}$/.test(parts[4])) return null;
  return {
    schoolId,
    cardId,
    nonce: parts[3],
    signed: parts.slice(0, 4).join("."),
    signature: parts[4],
  };
}

export async function verifyCard(
  token: string,
  publicKey: string,
): Promise<"valid" | "invalid" | "unsupported"> {
  const c = parseCard(token);
  if (!c) return "invalid";
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
      fromB64u(c.signature),
      new TextEncoder().encode(c.signed),
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}
