import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Shell } from "@/components/ui";
import { SITE_URL } from "@/lib/hosts";
import { pick } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { setSignInLanguageAction } from "./actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Kiota",
  robots: { index: false, follow: false },
};

/** One sign-in for staff and parents. No sign-up: schools add people. */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Loading />
        </Shell>
      }
    >
      <SignIn />
    </Suspense>
  );
}

const FORM_KEYS = [
  "signin.phone",
  "signin.phoneHint",
  "signin.send",
  "signin.sending",
  "signin.enterCode",
  "signin.code",
  "signin.signIn",
  "signin.checking",
  "signin.resend",
  "signin.otherNumber",
] as const;

async function SignIn() {
  const { t, locale } = await getT();
  return (
    <Shell
      title={t("signin.title")}
      aside={
        <form action={setSignInLanguageAction}>
          <input type="hidden" name="lang" value={locale === "sw" ? "en" : "sw"} />
          <button
            type="submit"
            className="h-10 rounded-lg px-3 text-sm font-semibold text-teal hover:bg-egg-blue/30"
            lang={locale === "sw" ? "en" : "sw"}
          >
            {locale === "sw" ? t("lang.en") : t("lang.sw")}
          </button>
        </form>
      }
    >
      <SignInForm text={pick(t, FORM_KEYS)} />
      <p className="text-sm text-ink/60">
        {t("signin.noSignup")} {t("signin.runningSchool")}{" "}
        <a href={`${SITE_URL}/demo`} className="font-semibold text-teal hover:underline">
          {t("signin.demo")}
        </a>
        .
      </p>
    </Shell>
  );
}
