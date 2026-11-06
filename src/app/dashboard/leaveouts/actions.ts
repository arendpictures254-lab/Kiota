"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import {
  approveLeaveout,
  cancelLeaveout,
  declineLeaveout,
  halfTermPasses,
  parseLeaveoutInput,
  requestLeaveout,
} from "@/lib/leaveout/service";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";

function done(id?: string) {
  revalidatePath("/dashboard/leaveouts", "layout");
  if (id) revalidatePath(`/dashboard/leaveouts/${id}`);
  kickMessageWorker();
}

export async function requestLeaveoutAction(_s: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const r = await attempt(async () => {
    const actor = await currentActor();
    id = (await requestLeaveout(deps, actor, parseLeaveoutInput(formObject(form)))).id;
  });
  if (r.error) return r;
  done(id);
  redirect(`/dashboard/leaveouts/${id}?new=1`);
}

export async function approveLeaveoutAction(_s: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const r = await attempt(async () => approveLeaveout(deps, await currentActor(), id));
  if (r.error) return r;
  done(id);
  redirect(`/dashboard/leaveouts/${id}?done=approved`);
}

export async function declineLeaveoutAction(_s: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const r = await attempt(async () =>
    declineLeaveout(deps, await currentActor(), id, form.get("reason")),
  );
  if (r.error) return r;
  done(id);
  redirect(`/dashboard/leaveouts/${id}?done=declined`);
}

export async function cancelLeaveoutAction(_s: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const r = await attempt(
    async () => cancelLeaveout(deps, await currentActor(), id, form.get("reason")),
    "Cancelled. The pass no longer works at the gate.",
  );
  done(id);
  return r;
}

export async function halfTermAction(_s: FormState, form: FormData): Promise<FormState> {
  let message = "";
  const r = await attempt(async () => {
    const res = await halfTermPasses(deps, await currentActor(), formObject(form));
    message =
      `${res.created} pass${res.created === 1 ? "" : "es"} issued for ${res.label}. Collectors get their pickup codes by SMS.` +
      (res.skipped.length
        ? ` Not issued (${res.skipped.length}): ${res.skipped.map((s) => `${s.name}, ${s.why}`).join("; ")}.`
        : "");
  });
  done();
  return r.error ? r : { ok: message };
}
