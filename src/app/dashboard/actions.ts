"use server";

import { revalidatePath } from "next/cache";
import { clientIp, requirePermission } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { setSupportAccess } from "@/lib/staff/service";

/** Director: let Arend Studio support see this school for 24 hours, or turn it off. */
export async function supportAccessAction(form: FormData): Promise<void> {
  const ctx = await requirePermission("school.settings.manage");
  const on = form.get("on") === "1";
  await setSupportAccess(
    { db: platformDb },
    {
      userId: ctx.user.id,
      schoolId: ctx.school.id,
      permissions: ctx.permissions,
      ip: await clientIp(),
    },
    on ? 24 : null,
  );
  revalidatePath("/dashboard");
}
