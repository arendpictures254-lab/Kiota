"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientIp, requireUser } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permissions";
import { platformDb } from "@/lib/db";
import { sendPlatformSms } from "@/lib/sms";
import { ValidationError, createSchool, setSchoolModules } from "@/lib/staff/service";

export type CreateSchoolState = { error?: string; field?: string };

export async function createSchoolAction(
  _prev: CreateSchoolState,
  form: FormData,
): Promise<CreateSchoolState> {
  const user = await requireUser();
  const name = String(form.get("name") ?? "");
  try {
    const { directorPhone } = await createSchool(
      { db: platformDb },
      { userId: user.id, isPlatformAdmin: user.isPlatformAdmin, ip: await clientIp() },
      {
        name,
        shortName: String(form.get("shortName") ?? ""),
        county: String(form.get("county") ?? ""),
        levelsOffered: form.getAll("levels").map(String),
        directorName: String(form.get("directorName") ?? ""),
        directorPhone: String(form.get("directorPhone") ?? ""),
      },
    );
    await sendPlatformSms({
      to: directorPhone,
      text: `Welcome to Kiota. ${name.trim()} is ready for you as Director. Sign in at kiota.app with this phone number.`,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "Only Arend Studio admins can do this." };
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    throw err;
  }
  revalidatePath("/admin");
  redirect("/admin?created=1");
}

export async function setModulesAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await setSchoolModules(
    { db: platformDb },
    { userId: user.id, isPlatformAdmin: user.isPlatformAdmin, ip: await clientIp() },
    String(form.get("schoolId") ?? ""),
    form.getAll("modules").map(String),
  );
  revalidatePath("/admin");
}
