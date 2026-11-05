"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { clientIp, getMe, listMySchools } from "@/lib/auth/context";
import { createOtpService } from "@/lib/auth/otp";
import { createSession, setSessionSchool } from "@/lib/auth/session";
import { inContext, platformDb } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { sendPlatformSms } from "@/lib/sms";

export type SignInState = {
  step: "phone" | "code";
  phone?: string;
  error?: string;
  message?: string;
};

function otp() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createOtpService({ db: platformDb, sendSms: sendPlatformSms, secret });
}

export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const intent = String(form.get("intent") ?? "send");
  const phone = normalizePhone(String(form.get("phone") ?? ""));

  if (!phone) {
    return { step: "phone", error: "Enter your phone number, like 0712 345 678." };
  }

  if (intent === "send" || intent === "resend") {
    const result = await otp().requestCode(phone);
    if (!result.ok) {
      return {
        step: intent === "resend" ? "code" : "phone",
        phone,
        error:
          result.reason === "unknown_phone"
            ? "We don't recognise this number. Ask your school to add you to Kiota."
            : "Too many codes requested. Wait 15 minutes, then try again.",
      };
    }
    return { step: "code", phone, message: "We sent a 6-digit code by SMS." };
  }

  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { step: "code", phone, error: "Enter the 6-digit code." };

  const result = await otp().verifyCode(phone, code);
  if (!result.ok) {
    const error =
      result.reason === "wrong_code"
        ? `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left.`
        : result.reason === "too_many_attempts"
          ? "Too many wrong tries. Ask for a new code."
          : "That code has expired. Ask for a new code.";
    return { step: "code", phone, error };
  }

  const userId = result.userId;
  const session = await createSession(userId);
  const ip = await clientIp();
  await inContext({ userId, schoolId: null }, (tx) =>
    audit(tx, { schoolId: null, actorId: userId, action: "auth.sign_in", ip }),
  );

  const [schools, me] = await Promise.all([listMySchools(userId), getMe(userId)]);
  if (schools.length === 1) {
    await setSessionSchool(session.id, schools[0].school_id);
    redirect("/dashboard");
  }
  if (schools.length === 0 && me?.isPlatformAdmin) redirect("/admin");
  redirect("/schools");
}
