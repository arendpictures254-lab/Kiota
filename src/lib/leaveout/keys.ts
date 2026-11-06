/**
 * The school's pass signing key (server only). Made on first use; the private key is encrypted
 * with CREDENTIALS_ENCRYPTION_KEY and never leaves the server. Gate devices get the public key.
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import type { Tx } from "@/lib/db-core";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { encodePass, passMessage, randomNonce } from "./pass-token";

export async function schoolPassKey(tx: Tx, schoolId: string) {
  const found = await tx.leaveoutPassKey.findUnique({ where: { schoolId } });
  if (found) return found;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const der = privateKey.export({ format: "der", type: "pkcs8" });
  await tx.leaveoutPassKey.createMany({
    data: [
      {
        schoolId,
        publicKey: String(jwk.x),
        privateKeyEnc: encryptSecret(Buffer.from(der).toString("base64")),
      },
    ],
    skipDuplicates: true, // two approvals at the same moment: the first key wins
  });
  return tx.leaveoutPassKey.findUniqueOrThrow({ where: { schoolId } });
}

/** A new signed pass token for this leave-out (a new nonce each time). */
export async function signPass(tx: Tx, schoolId: string, leaveoutId: string) {
  const key = await schoolPassKey(tx, schoolId);
  const message = passMessage(schoolId, leaveoutId, randomNonce());
  const pk = createPrivateKey({
    key: Buffer.from(decryptSecret(key.privateKeyEnc), "base64"),
    format: "der",
    type: "pkcs8",
  });
  return encodePass(message, new Uint8Array(sign(null, Buffer.from(message), pk)));
}
