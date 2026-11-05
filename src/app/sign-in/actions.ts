"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { clientIp, getMe, listMySchools } from "@/lib/auth/context";
import { createOtpService } from "@/lib/auth/otp";
import { createSession, setSessionMode, setSessionSchool } from "@/lib/auth/session";
import { inContext, platformDb } from "@/lib/db";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { normalizePhone } from "@/lib/phone";
import { homeFor, myChildren, recordParentSignIn } from "@/lib/portal/service";
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
  const { t } = await getT();
  const intent = String(form.get("intent") ?? "send");
  const phone = normalizePhone(String(form.get("phone") ?? ""));

  if (!phone) {
    return { step: "phone", error: t("signin.badPhone") };
  }

  if (intent === "send" || intent === "resend") {
    const result = await otp().requestCode(phone);
    if (!result.ok) {
      return {
        step: intent === "resend" ? "code" : "phone",
        phone,
        // No self sign-up: a number no school has added is told to contact the school.
        error: result.reason === "unknown_phone" ? t("signin.unknown") : t("signin.rateLimited"),
      };
    }
    return { step: "code", phone, message: t("signin.sent") };
  }

  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { step: "code", phone, error: t("signin.enterSix") };

  const result = await otp().verifyCode(phone, code);
  if (!result.ok) {
    const error =
      result.reason === "wrong_code"
        ? result.attemptsLeft === 1
          ? t("signin.wrongOne")
          : t("signin.wrongMany", { n: result.attemptsLeft })
        : result.reason === "too_many_attempts"
          ? t("signin.tooMany")
          : t("signin.expired");
    return { step: "code", phone, error };
  }

  const userId = result.userId;
  const session = await createSession(userId);
  const ip = await clientIp();
  await inContext({ userId, schoolId: null }, (tx) =>
    audit(tx, { schoolId: null, actorId: userId, action: "auth.sign_in", ip }),
  );

  const deps = { db: platformDb };
  const [schools, me, children] = await Promise.all([
    listMySchools(userId),
    getMe(userId),
    myChildren(deps, userId),
  ]);
  if (children.length) await recordParentSignIn(deps, userId);
  const home = homeFor({
    staffSchools: schools.length,
    isPlatformAdmin: !!me?.isPlatformAdmin,
    hasChildren: children.length > 0,
    mode: null,
  });
  if (home === "/parent") await setSessionMode(session.id, "parent");
  if (home === "/dashboard") {
    await setSessionMode(session.id, "staff");
    await setSessionSchool(session.id, schools[0].school_id);
  }
  redirect(home);
}

/** The language switch on the sign-in page (before anyone is signed in). */
export async function setSignInLanguageAction(form: FormData): Promise<void> {
  const lang = String(form.get("lang") ?? "");
  if (isLocale(lang)) {
    (await cookies()).set(LOCALE_COOKIE, lang, {
      path: "/",
      sameSite: "lax",
      maxAge: 365 * 24 * 3600,
    });
  }
  redirect("/sign-in");
}
