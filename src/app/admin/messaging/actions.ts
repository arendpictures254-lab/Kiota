"use server";

import { revalidatePath } from "next/cache";
import { type FormState, attempt, formObject } from "@/lib/actions";
import { clientIp, requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { adminCreditWallet, adminSetTemplateStatus, adminSetWallet } from "@/lib/messaging/wallet";

const deps = { db: platformDb };

async function admin() {
  const user = await requireUser();
  return { userId: user.id, isPlatformAdmin: user.isPlatformAdmin, ip: await clientIp() };
}

function done() {
  revalidatePath("/admin/messaging");
}

export async function walletSettingsAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      adminSetWallet(deps, await admin(), f.schoolId, {
        ...f,
        senderIdApproved: f.senderIdApproved,
      }),
    "Saved.",
  );
  done();
  return r;
}

export async function creditWalletAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () => adminCreditWallet(deps, await admin(), f.schoolId, f),
    "Credit added.",
  );
  done();
  return r;
}

export async function templateStatusAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () => adminSetTemplateStatus(deps, await admin(), f.key, f.language, f.status),
    "Saved.",
  );
  done();
  return r;
}
