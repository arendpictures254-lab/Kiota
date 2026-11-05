"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import * as invoicing from "@/lib/fees/invoicing";
import { parseManualPayment, recordManualPayment, reversePayment } from "@/lib/fees/payments";
import { addPledge, cancelPledge } from "@/lib/fees/reports";
import { type SendState, toPreviewView } from "@/lib/messaging/preview-view";
import { sendStep } from "@/lib/messaging/send-step";
import { previewFeeReminders, sendFeeReminders } from "@/lib/messaging/service";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";
import * as setup from "@/lib/fees/setup";
import * as mpesa from "@/lib/mpesa/service";
import { ValidationError, clean, ctxOf } from "@/lib/service-kit";

/** Form fields for service functions that validate their own input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fields = (form: FormData): any => formObject(form);

function done() {
  revalidatePath("/dashboard/fees", "layout");
  revalidatePath("/dashboard/students", "layout");
}

/** Admission number -> student id (in the current school). */
async function studentIdFor(raw: unknown) {
  const actor = await currentActor();
  const admission = clean(raw) ?? "";
  const s = await withContext(deps.db, ctxOf(actor), (tx) =>
    tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: actor.schoolId, admissionNumber: admission } },
      select: { id: true },
    }),
  );
  if (!s)
    throw new ValidationError(`No student has admission number "${admission}".`, "admissionNumber");
  return s.id;
}

// ---- Payments and receipts ----

export async function recordPaymentAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let receiptId = "";
  const r = await attempt(async () => {
    const studentId = await studentIdFor(f.admissionNumber);
    const input = parseManualPayment({ ...fields(form), studentId });
    receiptId = (await recordManualPayment(deps, await currentActor(), input)).receipt.id;
  });
  if (r.error) return r;
  done();
  kickMessageWorker();
  redirect(`/dashboard/fees/receipts/${receiptId}?new=1`);
}

export async function reversePaymentAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () => reversePayment(deps, await currentActor(), f.paymentId, f.reason),
    "Reversed. The Director has been notified.",
  );
  done();
  return r;
}

// ---- Setup ----

export async function defaultVoteHeadsAction(): Promise<FormState> {
  const r = await attempt(
    async () => setup.createDefaultVoteHeads(deps, await currentActor()),
    "Vote heads created.",
  );
  done();
  return r;
}

export async function addVoteHeadAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setup.addVoteHead(deps, await currentActor(), formObject(form).name),
    "Vote head added.",
  );
  done();
  return r;
}

export async function moveVoteHeadAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () =>
    setup.moveVoteHead(
      deps,
      await currentActor(),
      f.voteHeadId,
      f.direction === "up" ? "up" : "down",
    ),
  );
  done();
  return r;
}

export async function addFeeItemAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setup.addFeeItem(deps, await currentActor(), fields(form)),
    "Fee item added.",
  );
  done();
  return r;
}

export async function saveStructureAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const amounts: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) if (k.startsWith("amount_")) amounts[k.slice(7)] = v;
  const installments = [0, 1, 2, 3].map((i) => ({
    dueDate: f[`due_${i}`],
    percent: f[`pct_${i}`],
  }));
  const r = await attempt(
    async () =>
      setup.saveFeeStructure(deps, await currentActor(), {
        termId: f.termId,
        levelId: f.levelId,
        appliesTo: f.appliesTo === "day" ? "day" : "boarder",
        amounts,
        installments,
      }),
    "Fee structure saved.",
  );
  done();
  return r;
}

export async function addDiscountAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setup.addSiblingDiscount(deps, await currentActor(), fields(form)),
    "Discount added.",
  );
  done();
  return r;
}

export async function toggleDiscountAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () =>
    setup.setDiscountActive(deps, await currentActor(), f.ruleId, f.active === "1"),
  );
  done();
  return r;
}

export async function addBursaryAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setup.addBursary(deps, await currentActor(), fields(form)),
    "Bursary added.",
  );
  done();
  return r;
}

export async function endBursaryAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    setup.endBursary(deps, await currentActor(), formObject(form).bursaryId),
  );
  done();
  return r;
}

// ---- Invoices, opening balances, charges ----

export async function generateInvoicesAction(_s: FormState, form: FormData): Promise<FormState> {
  let message = "";
  const r = await attempt(async () => {
    const totals = await invoicing.generateTermInvoices(
      deps,
      await currentActor(),
      formObject(form).termId,
    );
    message = `${totals.invoices} invoices created.`;
  });
  done();
  return r.error ? r : { ok: message };
}

export async function postOpeningBalancesAction(): Promise<FormState> {
  let message = "";
  const r = await attempt(async () => {
    const res = await invoicing.postOpeningBalances(deps, await currentActor());
    message = `${res.count} opening balances posted to the ledger.`;
  });
  done();
  return r.error ? r : { ok: message };
}

export async function addChargeAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => invoicing.addCharge(deps, await currentActor(), fields(form)),
    "Charge added to the student's account.",
  );
  done();
  return r;
}

// ---- M-Pesa ----

export async function saveMpesaSettingsAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => mpesa.saveMpesaSettings(deps, await currentActor(), fields(form)),
    "M-Pesa settings saved.",
  );
  done();
  return r;
}

export async function registerUrlsAction(): Promise<FormState> {
  return attempt(async () => {
    try {
      await mpesa.registerC2BUrls(deps, await currentActor());
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`Safaricom refused: ${(err as Error).message}`);
    }
  }, "Callback URLs registered with Safaricom.");
}

export async function sendStkAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let message = "";
  const r = await attempt(async () => {
    const studentId = await studentIdFor(f.admissionNumber);
    try {
      message = (
        await mpesa.sendStkPush(deps, await currentActor(), {
          studentId,
          phone: f.phone,
          amount: f.amount,
        })
      ).message;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`Safaricom did not accept the prompt: ${(err as Error).message}`);
    }
  });
  done();
  return r.error ? r : { ok: `Prompt sent to the phone. ${message}` };
}

export async function assignSuspenseAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let receiptId = "";
  const r = await attempt(async () => {
    receiptId = (await mpesa.assignSuspense(deps, await currentActor(), f.txnId, f.admissionNumber))
      .receiptId;
  });
  if (r.error) return r;
  done();
  kickMessageWorker();
  redirect(`/dashboard/fees/receipts/${receiptId}?new=1`);
}

export async function retryVerificationAction(_s: FormState, form: FormData): Promise<FormState> {
  let outcome = "";
  const r = await attempt(async () => {
    outcome = String(
      await mpesa.retryVerification(deps, await currentActor(), formObject(form).txnId),
    );
  });
  done();
  return r.error ? r : { ok: `Checked with Safaricom: ${outcome}.` };
}

// ---- Reports and pledges ----

export async function sendRemindersAction(_s: SendState, form: FormData): Promise<SendState> {
  const ids = form.getAll("studentId").map(String);
  return sendStep(async () => {
    const actor = await currentActor();
    if (form.get("step") === "send") {
      const r = await sendFeeReminders(deps, actor, ids, Number(form.get("expectedCost") ?? NaN));
      kickMessageWorker();
      revalidatePath("/dashboard/messages", "layout");
      return {
        ok: `Sending reminders to ${r.recipients} parent${r.recipients === 1 ? "" : "s"} of ${r.students} student${r.students === 1 ? "" : "s"}.`,
      };
    }
    const p = await previewFeeReminders(deps, actor, ids);
    return {
      preview: toPreviewView(
        p,
        p.noContact
          ? `${p.noContact} student${p.noContact === 1 ? " has" : "s have"} no fee contact and will not get a reminder.`
          : null,
      ),
    };
  });
}

export async function addPledgeAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => addPledge(deps, await currentActor(), fields(form)),
    "Pledge recorded.",
  );
  done();
  return r;
}

export async function cancelPledgeAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    cancelPledge(deps, await currentActor(), formObject(form).pledgeId),
  );
  done();
  return r;
}

// ---- Notifications ----

export async function markNotificationReadAction(form: FormData): Promise<void> {
  const actor = await currentActor();
  await withContext(deps.db, ctxOf(actor), (tx) =>
    tx.notification.updateMany({
      where: { schoolId: actor.schoolId, id: String(form.get("id") ?? ""), readAt: null },
      data: { readAt: new Date() },
    }),
  );
  revalidatePath("/dashboard");
}
