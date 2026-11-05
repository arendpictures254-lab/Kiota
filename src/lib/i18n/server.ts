import "server-only";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/context";
import { LOCALE_COOKIE, type Locale, isLocale, translator } from "./index";

/** The signed-in person's language, else the language chosen on the sign-in page, else English. */
export async function getLocale(): Promise<Locale> {
  const user = await getCurrentUser();
  if (user && isLocale(user.preferredLanguage)) return user.preferredLanguage;
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(c) ? c : "en";
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: translator(locale) };
}
