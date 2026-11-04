"use server";

import { redirect } from "next/navigation";
import { listMySchools, requireUser } from "@/lib/auth/context";
import { destroySession, setSessionSchool } from "@/lib/auth/session";

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
  redirect("/dashboard");
}
