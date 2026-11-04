"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientIp, requireSchool, type SchoolContext } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permissions";
import { platformDb } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import {
  type Actor,
  ValidationError,
  inviteStaff,
  setLeaveoutApproval,
  setStaffRoles,
} from "@/lib/staff/service";

export type FormState = { error?: string; field?: string; ok?: string };

async function actor(ctx: SchoolContext): Promise<Actor> {
  return {
    userId: ctx.user.id,
    schoolId: ctx.school.id,
    permissions: ctx.permissions,
    ip: await clientIp(),
  };
}

function toState(err: unknown): FormState {
  if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
  if (err instanceof ValidationError) return { error: err.message, field: err.field };
  throw err;
}

export async function inviteStaffAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireSchool();
  let membershipId: string;
  try {
    const result = await inviteStaff({ db: platformDb }, await actor(ctx), {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      roleKeys: form.getAll("roles").map(String),
    });
    if (result.alreadyMember) {
      return { error: "This person is already on your staff list.", field: "phone" };
    }
    membershipId = result.membershipId;
    await sendSms({
      to: result.phone,
      text: `${ctx.school.name} has added you to Kiota. Sign in at kiota.app with this phone number.`,
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/dashboard/staff");
  redirect(`/dashboard/staff/${membershipId}?invited=1`);
}

export async function setRolesAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireSchool();
  const membershipId = String(form.get("membershipId") ?? "");
  try {
    await setStaffRoles(
      { db: platformDb },
      await actor(ctx),
      membershipId,
      form.getAll("roles").map(String),
    );
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/dashboard/staff/${membershipId}`);
  return { ok: "Roles saved." };
}

export async function leaveoutApprovalAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await requireSchool();
  const membershipId = String(form.get("membershipId") ?? "");
  const allow = form.get("allow") === "1";
  try {
    await setLeaveoutApproval({ db: platformDb }, await actor(ctx), membershipId, allow);
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/dashboard/staff/${membershipId}`);
  revalidatePath("/dashboard/staff");
  return { ok: allow ? "They can now approve leave-outs." : "Leave-out approval withdrawn." };
}
