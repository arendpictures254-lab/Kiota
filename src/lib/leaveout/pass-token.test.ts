// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodePass,
  parsePass,
  passMessage,
  pickupCodeHash,
  randomNonce,
  verifyPass,
} from "./pass-token";

const SCHOOL = "0b7f6a2e-2f5c-4b8e-9d7a-1c2b3d4e5f60";
const LEAVEOUT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { pub: String(publicKey.export({ format: "jwk" }).x), privateKey };
}

function token(privateKey: ReturnType<typeof keyPair>["privateKey"], leaveoutId = LEAVEOUT) {
  const msg = passMessage(SCHOOL, leaveoutId, randomNonce());
  return encodePass(msg, new Uint8Array(sign(null, Buffer.from(msg), privateKey)));
}

describe("gate pass tokens", () => {
  it("carry only ids and a signature, and check offline with the public key", async () => {
    const k = keyPair();
    const t = token(k.privateKey);
    expect(t).toMatch(/^KP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(t.length).toBeLessThan(160);
    expect(parsePass(t)).toMatchObject({ schoolId: SCHOOL, leaveoutId: LEAVEOUT });
    expect(await verifyPass(t, k.pub)).toBe("valid");
  });

  it("reject a changed token, another school's key, and things that are not passes", async () => {
    const k = keyPair();
    const other = keyPair();
    const t = token(k.privateKey);
    const parts = t.split(".");
    const forged = [
      parts[0],
      parts[1],
      parsePass(token(k.privateKey, SCHOOL))!.signed.split(".")[2],
      parts[3],
      parts[4],
    ].join(".");
    expect(await verifyPass(forged, k.pub)).toBe("invalid");
    expect(await verifyPass(t, other.pub)).toBe("invalid");
    expect(parsePass("hello")).toBeNull();
    expect(parsePass("https://example.com/?KP1")).toBeNull();
    expect(await verifyPass("KP1.x.y.z.w", k.pub)).toBe("invalid");
  });

  it("hash the pickup code with the leave-out id (the gate never stores the code)", async () => {
    const h = await pickupCodeHash(LEAVEOUT, "4821");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await pickupCodeHash(LEAVEOUT, " 4821 ")).toBe(h);
    expect(await pickupCodeHash(LEAVEOUT, "4822")).not.toBe(h);
    expect(await pickupCodeHash(SCHOOL, "4821")).not.toBe(h);
  });
});
