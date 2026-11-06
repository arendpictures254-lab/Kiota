"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n";
import {
  ParentLeaveoutError,
  parentAnswerCollector,
  parentCancelLeaveout,
  parentRequestLeaveout,
} from "@/lib/leaveout/parent";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";
import { myChild } from "@/lib/portal/service";

const deps = { db: platformDb };

export type RequestState = { error?: string; field?: string };

export async function parentRequestAction(_s: RequestState, form: FormData): Promise<RequestState> {
  const user = await requireUser();
  const { t } = await getT();
  const linkId = String(form.get("linkId") ?? "");
  const child = await myChild(deps, user.id, linkId);
  try {
    await parentRequestLeaveout(deps, user.id, linkId, Object.fromEntries(form.entries()));
  } catch (err) {
    if (err instanceof ParentLeaveoutError) {
      return {
        error: t(`lo.err.${err.message}` as MessageKey, { child: child?.firstName ?? "" }),
        field: err.field,
      };
    }
    throw err;
  }
  revalidatePath(`/parent/${linkId}/leaveouts`);
  redirect(`/parent/${linkId}/leaveouts?sent=1`);
}

export async function answerCollectorAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(form.get("linkId") ?? "");
  await parentAnswerCollector(
    deps,
    user.id,
    String(form.get("leaveoutId") ?? ""),
    form.get("yes") === "1",
  );
  kickMessageWorker();
  revalidatePath(`/parent/${linkId}/leaveouts`);
}

export async function parentCancelAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const linkId = String(form.get("linkId") ?? "");
  await parentCancelLeaveout(deps, user.id, String(form.get("leaveoutId") ?? ""));
  revalidatePath(`/parent/${linkId}/leaveouts`);
}
