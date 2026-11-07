"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { parseDay } from "@/lib/attendance/rules";
import { resolveBoarderAlert, submitRegister } from "@/lib/attendance/service";
import { markStaff, tapStaffAttendance } from "@/lib/attendance/staff";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";
import {
  saveAttendanceSession,
  updateAbsenceSettings,
  updateSchoolWeek,
} from "@/lib/settings/service";
import { ValidationError } from "@/lib/service-kit";

export async function submitRegisterAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  let counts = "";
  const r = await attempt(async () => {
    const date = parseDay(o.date);
    if (!date) throw new ValidationError("Choose a day.");
    const res = await submitRegister(deps, await currentActor(), {
      streamId: o.streamId ?? "",
      sessionId: o.sessionId ?? "",
      date,
      absent: form.getAll("absent").map(String),
      late: form.getAll("late").map(String),
    });
    counts = `${res.counts.absent}-${res.counts.late}-${res.corrected ? 1 : 0}`;
  });
  if (r.error) return r;
  revalidatePath("/dashboard", "layout");
  kickMessageWorker();
  redirect(`/dashboard/attendance?done=${counts}`);
}

export async function boarderAlertAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(async () =>
    resolveBoarderAlert(
      deps,
      await currentActor(),
      o.alertId ?? "",
      o.found === "1",
      o.note || null,
    ),
  );
  if (r.error) return r;
  revalidatePath("/dashboard", "layout");
  kickMessageWorker();
  redirect(`/dashboard/attendance/boarders?done=${o.found === "1" ? "found" : "not_found"}`);
}

export async function staffTapAction(_s: FormState, form: FormData): Promise<FormState> {
  const kind = form.get("kind") === "out" ? "out" : "in";
  const r = await attempt(
    async () => tapStaffAttendance(deps, await currentActor(), kind),
    kind === "in" ? "You're in. Have a good day." : "Leaving recorded. Go well.",
  );
  revalidatePath("/dashboard");
  return r;
}

export async function markStaffAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(
    async () =>
      markStaff(deps, await currentActor(), {
        membershipId: o.membershipId ?? "",
        status: o.status ?? "",
        note: o.note,
        date: parseDay(o.date) ?? undefined,
      }),
    "Saved.",
  );
  revalidatePath("/dashboard/attendance/staff");
  return r;
}

export async function absenceSettingsAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => updateAbsenceSettings(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  revalidatePath("/dashboard/attendance/settings");
  return r;
}

export async function sessionAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveAttendanceSession(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  revalidatePath("/dashboard/attendance", "layout");
  return r;
}

export async function schoolWeekAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () =>
      updateSchoolWeek(deps, await currentActor(), {
        days: form.getAll("days"),
        saturdayLevels: form.getAll("saturdayLevels"),
      }),
    "Saved.",
  );
  revalidatePath("/dashboard/attendance", "layout");
  return r;
}
