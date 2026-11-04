/**
 * One-time sign-in codes sent by SMS.
 * - 6 digits, valid for 5 minutes, at most 5 tries per code.
 * - At most 3 codes per phone number per 15 minutes.
 * - Only a keyed hash of the code is stored.
 * Dependencies are passed in so the flow can be tested without SMS or a real clock.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SmsMessage } from "@/lib/sms";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RATE_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_PER_WINDOW = 3;

export type OtpDeps = {
  /** App-role client (otp_codes is a platform table). */
  db: PrismaClient;
  sendSms: (message: SmsMessage) => Promise<void>;
  secret: string;
  now?: () => Date;
  generateCode?: () => string;
};

export type RequestResult = { ok: true } | { ok: false; reason: "unknown_phone" | "rate_limited" };

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "no_code" | "too_many_attempts" }
  | { ok: false; reason: "wrong_code"; attemptsLeft: number };

export function hashCode(secret: string, phone: string, code: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createOtpService(deps: OtpDeps) {
  const now = deps.now ?? (() => new Date());
  const generateCode =
    deps.generateCode ?? (() => randomInt(0, 1_000_000).toString().padStart(6, "0"));

  /** `phone` must already be normalised to E.164. */
  async function requestCode(phone: string): Promise<RequestResult> {
    const [{ allowed }] = await deps.db.$queryRaw<{ allowed: boolean }[]>`
      SELECT app_phone_can_sign_in(${phone}) AS allowed`;
    if (!allowed) return { ok: false, reason: "unknown_phone" };

    const t = now();
    const recent = await deps.db.otpCode.count({
      where: { phone, createdAt: { gt: new Date(t.getTime() - OTP_RATE_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_PER_WINDOW) return { ok: false, reason: "rate_limited" };

    const code = generateCode();
    await deps.db.$transaction([
      // A new code replaces any earlier one.
      deps.db.otpCode.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: t },
      }),
      deps.db.otpCode.create({
        data: {
          phone,
          codeHash: hashCode(deps.secret, phone, code),
          expiresAt: new Date(t.getTime() + OTP_TTL_MS),
          createdAt: t,
        },
      }),
    ]);

    await deps.sendSms({
      to: phone,
      text: `Your Kiota sign-in code is ${code}. It expires in 5 minutes. Never share this code.`,
    });
    return { ok: true };
  }

  async function verifyCode(phone: string, code: string): Promise<VerifyResult> {
    const t = now();
    const current = await deps.db.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: t } },
      orderBy: { createdAt: "desc" },
    });
    if (!current) return { ok: false, reason: "no_code" };
    if (current.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

    // Count this attempt first, atomically, so parallel guesses cannot exceed the limit.
    const counted = await deps.db.otpCode.updateMany({
      where: { id: current.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) return { ok: false, reason: "too_many_attempts" };

    const cleanCode = code.replace(/\D/g, "");
    if (!sameHash(current.codeHash, hashCode(deps.secret, phone, cleanCode))) {
      const attemptsLeft = OTP_MAX_ATTEMPTS - (current.attempts + 1);
      return attemptsLeft > 0
        ? { ok: false, reason: "wrong_code", attemptsLeft }
        : { ok: false, reason: "too_many_attempts" };
    }

    const consumed = await deps.db.otpCode.updateMany({
      where: { id: current.id, consumedAt: null },
      data: { consumedAt: t },
    });
    if (consumed.count === 0) return { ok: false, reason: "no_code" };

    const [{ id }] = await deps.db.$queryRaw<{ id: string | null }[]>`
      SELECT app_auth_user_id(${phone}) AS id`;
    if (!id) return { ok: false, reason: "no_code" };
    return { ok: true, userId: id };
  }

  return { requestCode, verifyCode };
}
