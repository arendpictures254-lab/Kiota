"use server";

import { revalidatePath } from "next/cache";
import { type FormState, attempt } from "@/lib/actions";
import { requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { setDemoStatus } from "@/lib/demo/service";

export async function setDemoStatusAction(_s: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const r = await attempt(
    () =>
      setDemoStatus(
        platformDb,
        { userId: user.id, isPlatformAdmin: user.isPlatformAdmin },
        String(form.get("id") ?? ""),
        String(form.get("status") ?? ""),
      ),
    "Status saved.",
  );
  revalidatePath("/admin/demo-requests");
  return r;
}
