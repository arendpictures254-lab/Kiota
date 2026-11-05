"use server";

import { revalidatePath } from "next/cache";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { type SendState, toPreviewView } from "@/lib/messaging/preview-view";
import { sendStep } from "@/lib/messaging/send-step";
import {
  parseInviteInput,
  parseNoticeInput,
  previewInvite,
  previewNotice,
  sendInvite,
  sendNotice,
} from "@/lib/messaging/service";
import { requestWalletTopup, retryTopup, setLowBalanceThreshold } from "@/lib/messaging/wallet";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";

function done() {
  revalidatePath("/dashboard/messages", "layout");
}

export async function noticeAction(_s: SendState, form: FormData): Promise<SendState> {
  return sendStep(async () => {
    const actor = await currentActor();
    const input = parseNoticeInput(formObject(form));
    if (form.get("step") === "send") {
      const r = await sendNotice(deps, actor, input, Number(form.get("expectedCost") ?? NaN));
      kickMessageWorker();
      done();
      return {
        ok: `Sending to ${r.recipients} parent${r.recipients === 1 ? "" : "s"} (${kes(r.costCents)}). Follow it in Message history.`,
      };
    }
    const p = await previewNotice(deps, actor, input);
    return { preview: toPreviewView(p, `To: ${p.audienceLabel}`) };
  });
}

export async function inviteAction(_s: SendState, form: FormData): Promise<SendState> {
  return sendStep(async () => {
    const actor = await currentActor();
    const input = parseInviteInput(formObject(form));
    if (form.get("step") === "send") {
      const r = await sendInvite(deps, actor, input, Number(form.get("expectedCost") ?? NaN));
      kickMessageWorker();
      done();
      return {
        ok: `Inviting ${r.recipients} parent${r.recipients === 1 ? "" : "s"} (${kes(r.costCents)}). Follow it in Message history.`,
      };
    }
    const p = await previewInvite(deps, actor, input);
    return { preview: toPreviewView(p, `To: ${p.audienceLabel}`) };
  });
}

export async function topupAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let message = "";
  const r = await attempt(async () => {
    message = (
      await requestWalletTopup(deps, await currentActor(), { amount: f.amount, phone: f.phone })
    ).message;
  });
  done();
  return r.error
    ? r
    : { ok: `Prompt sent to ${f.phone}. Enter the M-Pesa PIN on that phone. (${message})` };
}

export async function retryTopupAction(_s: FormState, form: FormData): Promise<FormState> {
  let outcome = "";
  const r = await attempt(async () => {
    outcome = await retryTopup(deps, await currentActor(), formObject(form).topupId);
  });
  done();
  return r.error
    ? r
    : {
        ok:
          outcome === "completed"
            ? "Confirmed and added to the wallet."
            : "Safaricom has not confirmed it yet.",
      };
}

export async function thresholdAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setLowBalanceThreshold(deps, await currentActor(), formObject(form).threshold),
    "Saved. You will be told when the balance drops below this.",
  );
  done();
  return r;
}
