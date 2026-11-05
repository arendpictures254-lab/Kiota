"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listMySchools, requireUser } from "@/lib/auth/context";
import {
  destroyAllSessions,
  destroySession,
  setSessionMode,
  setSessionSchool,
} from "@/lib/auth/session";
import { platformDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { homeFor, myChildren, setMyLanguage } from "@/lib/portal/service";

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}

/** Open a school. Checked on the server: the user must be an active member of it. */
export async function chooseSchoolAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const schoolId = String(form.get("schoolId") ?? "");
  const mine = await listMySchools(user.id);
  if (!mine.some((s) => s.school_id === schoolId)) redirect("/schools");
  await setSessionSchool(user.session.id, schoolId);
  await setSessionMode(user.session.id, "staff");
  redirect("/dashboard");
}

/** Staff or parent, for people who are both. Checked: they must really be what they choose. */
export async function chooseModeAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const mode = form.get("mode") === "parent" ? "parent" : "staff";
  const [schools, children] = await Promise.all([
    listMySchools(user.id),
    myChildren({ db: platformDb }, user.id),
  ]);
  if (mode === "parent" && children.length === 0) redirect("/choose");
  if (mode === "staff" && schools.length === 0 && !user.isPlatformAdmin) redirect("/choose");
  await setSessionMode(user.session.id, mode);
  const home = homeFor({
    staffSchools: schools.length,
    isPlatformAdmin: user.isPlatformAdmin,
    hasChildren: children.length > 0,
    mode,
  });
  if (home === "/dashboard" && !user.session.schoolId) {
    await setSessionSchool(user.session.id, schools[0].school_id);
  }
  redirect(home);
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  await destroyAllSessions(user.id);
  redirect("/sign-in");
}

export async function setLanguageAction(
  _prev: { ok?: string; error?: string },
  form: FormData,
): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const lang = String(form.get("language") ?? "");
  try {
    await setMyLanguage({ db: platformDb }, user.id, lang);
  } catch {
    return { error: (await getT()).t("error.generic") };
  }
  revalidatePath("/", "layout");
  // Read the language again: the saved one is the one to answer in.
  const { translator } = await import("@/lib/i18n");
  return { ok: translator(lang === "sw" ? "sw" : "en")("account.saved") };
}
