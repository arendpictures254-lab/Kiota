import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { SITE_URL } from "@/lib/hosts";
import { pick } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { setSignInLanguageAction } from "./actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Kiota",
  robots: { index: false, follow: false },
};

/**
 * One sign-in for staff and parents. No sign-up: schools add people. A phone shows just the
 * form; from 1024 px the screen is split, with the brand on the left.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={<Loading />}>
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
  const other = locale === "sw" ? "en" : "sw";
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-teal p-12 text-cream lg:flex xl:p-16">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/brand/kiota-icon-mono-white.svg" alt="" width={40} height={40} />
          <span className="font-heading text-2xl font-bold">Kiota</span>
        </Link>
        <div className="flex max-w-md flex-col gap-6">
          <p className="font-heading text-[clamp(2rem,1.2rem+2vw,3.25rem)] leading-tight font-bold">
            {t("signin.tagline")}
          </p>
          <ul className="flex flex-col gap-3 text-lg text-cream/90">
            {(["signin.point1", "signin.point2", "signin.point3"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3">
                <span className="size-2 rounded-full bg-egg-blue" aria-hidden />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-cream/60">kiota.app</p>
      </section>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:justify-end lg:px-10">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Image src="/brand/kiota-icon.svg" alt="" width={28} height={28} />
            <span className="font-heading text-lg font-bold text-teal">Kiota</span>
          </Link>
          <form action={setSignInLanguageAction}>
            <input type="hidden" name="lang" value={other} />
            <button
              type="submit"
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-teal hover:bg-egg-blue/30"
              lang={other}
            >
              {other === "en" ? t("lang.en") : t("lang.sw")}
            </button>
          </form>
        </header>
        <main className="flex flex-1 flex-col justify-center px-4 py-8 sm:px-6">
          <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5">
            <h1 className="font-heading text-title font-bold text-ink">{t("signin.title")}</h1>
            <SignInForm text={pick(t, FORM_KEYS)} />
            <p className="text-sm text-ink/60">
              {t("signin.noSignup")} {t("signin.runningSchool")}{" "}
              <a href={`${SITE_URL}/demo`} className="font-semibold text-teal hover:underline">
                {t("signin.demo")}
              </a>
              .
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
