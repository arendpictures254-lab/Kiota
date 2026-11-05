/**
 * Payments, receipts and reversals. Append-only: a payment is never edited or deleted; mistakes
 * are corrected by a reversal that records the reason, who and when, and notifies the Director.
 */
import { randomBytes } from "node:crypto";
import { Prisma, type PaymentMethod } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { queuePaymentMessages } from "@/lib/messaging/service";
import { normalizePhone } from "@/lib/phone";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import { allocatePayment, kes, receiptNo } from "./allocation";
import {
  applyAvailableCredit,
  postEntry,
  rebalanceAfterReversal,
  studentPosition,
  voteHeadRefs,
} from "./ledger";

export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank deposit" },
  { value: "cheque", label: "Cheque" },
  { value: "mpesa", label: "M-Pesa" },
];

export const MAX_PAYMENT_CENTS = 1_000_000_000; // KES 10 million

/** Unguessable share token, e.g. "K7Q2M4XRW9TB3NZD" (80 bits). */
export function newShareToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Next receipt number for the school. The counter row is locked until the payment's transaction
 * ends, so concurrent payments queue up and a rolled-back payment gives its number back:
 * numbers are sequential with no gaps.
 */
export async function nextReceiptNumber(tx: Tx, schoolId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO receipt_counters (school_id, last_number) VALUES (${schoolId}::uuid, 1)
    ON CONFLICT (school_id) DO UPDATE SET last_number = receipt_counters.last_number + 1
    RETURNING last_number`;
  return row.last_number;
}

export type PostPaymentInput = {
  studentId: string;
  method: PaymentMethod;
  amountCents: number;
  reference: string | null;
  payerName: string | null;
  payerPhone: string | null;
  paidAt: Date;
  mpesaTransactionId?: string | null;
};

/**
 * Record a payment inside an existing transaction: payment row, allocation to vote heads by
 * priority (overpayment becomes credit), receipt with the next number. Used by manual entry,
 * M-Pesa callbacks and suspense assignment.
 */
export async function postPayment(tx: Tx, actor: Actor, input: PostPaymentInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError("Enter an amount above zero.", "amount");
  }
  if (input.amountCents > MAX_PAYMENT_CENTS) {
    throw new ValidationError("That amount is too large for one payment.", "amount");
  }
  const student = await tx.student.findUnique({
    where: { schoolId: actor.schoolId, id: input.studentId },
  });
  if (!student) throw new ValidationError("Choose a student.", "studentId");

  let payment;
  try {
    payment = await tx.payment.create({
      data: {
        schoolId: actor.schoolId,
        studentId: input.studentId,
        method: input.method,
        amountCents: input.amountCents,
        reference: input.reference,
        payerName: input.payerName,
        payerPhone: input.payerPhone,
        paidAt: input.paidAt,
        receivedById: actor.userId,
        mpesaTransactionId: input.mpesaTransactionId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError(
        `A ${input.method === "mpesa" ? "M-Pesa" : input.method} payment with reference ${input.reference} is already recorded.`,
        "reference",
      );
    }
    throw err;
  }

  const heads = await voteHeadRefs(tx, actor.schoolId);
  const before = await studentPosition(tx, actor.schoolId, input.studentId);
  const lines = allocatePayment(input.amountCents, before, heads);
  await postEntry(tx, {
    schoolId: actor.schoolId,
    studentId: input.studentId,
    type: "payment",
    description: `${input.method === "mpesa" ? "M-Pesa" : input.method[0].toUpperCase() + input.method.slice(1)} payment${input.reference ? ` ${input.reference}` : ""}`,
    createdById: actor.userId,
    paymentId: payment.id,
    lines,
  });

  const number = await nextReceiptNumber(tx, actor.schoolId);
  const receipt = await tx.receipt.create({
    data: {
      schoolId: actor.schoolId,
      paymentId: payment.id,
      number,
      balanceAfterCents: before.balanceCents - input.amountCents,
      shareToken: newShareToken(),
      issuedById: actor.userId,
    },
  });

  await audit(tx, {
    schoolId: actor.schoolId,
    actorId: actor.userId,
    action: "fees.payment",
    targetType: "payment",
    targetId: payment.id,
    after: {
      studentId: input.studentId,
      method: input.method,
      amountCents: input.amountCents,
      reference: input.reference,
      receiptNumber: number,
      allocation: lines,
    },
    ip: actor.ip,
  });

  // Tell the fee contacts: SMS with the new balance and receipt link (sent in the background).
  await queuePaymentMessages(tx, actor, {
    studentId: input.studentId,
    amountCents: input.amountCents,
    balanceAfterCents: receipt.balanceAfterCents,
    receiptNumber: number,
    shareToken: receipt.shareToken,
  });
  return { payment, receipt };
}

export type ManualPaymentRaw = {
  studentId: unknown;
  method: unknown;
  amount: unknown;
  reference?: unknown;
  payerName?: unknown;
  payerPhone?: unknown;
  paidAt?: unknown;
};

export function parseManualPayment(raw: ManualPaymentRaw, now = new Date()): PostPaymentInput {
  const studentId = clean(raw.studentId);
  if (!studentId) throw new ValidationError("Choose a student.", "studentId");
  const method = METHODS.find((m) => m.value === raw.method && m.value !== "mpesa")?.value;
  if (!method) throw new ValidationError("Choose cash, bank deposit or cheque.", "method");
  const parsed = parseKesToCents(raw.amount);
  if ("error" in parsed || parsed.cents === null || parsed.cents <= 0) {
    throw new ValidationError("Enter the amount in shillings, for example 12500.", "amount");
  }
  const reference = clean(raw.reference);
  if ((method === "bank" || method === "cheque") && !reference) {
    throw new ValidationError(
      method === "bank" ? "Enter the bank slip or transaction number." : "Enter the cheque number.",
      "reference",
    );
  }
  let paidAt = now;
  const d = clean(raw.paidAt);
  if (d) {
    paidAt = new Date(`${d}T12:00:00+03:00`);
    if (Number.isNaN(paidAt.getTime())) throw new ValidationError("Enter the date paid.", "paidAt");
    if (paidAt.getTime() > now.getTime() + 24 * 3600e3) {
      throw new ValidationError("The payment date cannot be in the future.", "paidAt");
    }
    if (now.getTime() - paidAt.getTime() > 120 * 24 * 3600e3) {
      throw new ValidationError(
        "Payments older than 120 days need the Director to record them.",
        "paidAt",
      );
    }
  }
  const phoneRaw = clean(raw.payerPhone);
  const payerPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !payerPhone)
    throw new ValidationError("Enter a valid phone number, or leave it blank.", "payerPhone");
  return {
    studentId,
    method,
    amountCents: parsed.cents,
    reference,
    payerName: clean(raw.payerName),
    payerPhone,
    paidAt,
  };
}

/** Bursar or clerk records cash, bank or cheque. Returns the receipt. */
export async function recordManualPayment({ db }: Deps, actor: Actor, input: PostPaymentInput) {
  assertCan(actor.permissions, "fees.collect");
  if (input.method === "mpesa") {
    throw new ValidationError("M-Pesa payments arrive automatically from Safaricom.", "method");
  }
  return withContext(db, ctxOf(actor), (tx) => postPayment(tx, actor, input));
}

/** Reverse a payment: negates its ledger lines, records who/why, notifies the Director(s). */
export async function reversePayment(
  { db }: Deps,
  actor: Actor,
  paymentId: string,
  rawReason: unknown,
) {
  assertCan(actor.permissions, "fees.reverse");
  const reason = clean(rawReason);
  if (!reason || reason.length < 5) {
    throw new ValidationError("Say why the payment is being reversed.", "reason");
  }
  return withContext(db, ctxOf(actor), async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { schoolId: actor.schoolId, id: paymentId },
      include: { receipt: true, reversal: true },
    });
    if (!payment) throw new ValidationError("Payment not found.");
    if (payment.reversal) throw new ValidationError("This payment has already been reversed.");

    const original = await tx.ledgerEntry.findFirst({
      where: { schoolId: actor.schoolId, paymentId, type: "payment" },
      include: { lines: true },
    });
    if (!original) throw new ValidationError("This payment has no ledger entry.");
    const entry = await postEntry(tx, {
      schoolId: actor.schoolId,
      studentId: payment.studentId,
      type: "reversal",
      description: `Reversal of receipt ${payment.receipt ? receiptNo(payment.receipt.number) : ""}: ${reason}`,
      createdById: actor.userId,
      paymentId,
      reversesEntryId: original.id,
      lines: original.lines.map((l) => ({ voteHeadId: l.voteHeadId, amountCents: -l.amountCents })),
    });
    await rebalanceAfterReversal(
      tx,
      { schoolId: actor.schoolId, userId: actor.userId },
      payment.studentId,
    );
    await applyAvailableCredit(
      tx,
      { schoolId: actor.schoolId, userId: actor.userId },
      payment.studentId,
    );

    const reversal = await tx.reversal.create({
      data: {
        schoolId: actor.schoolId,
        paymentId,
        reason,
        ledgerEntryId: entry.id,
        reversedById: actor.userId,
      },
    });

    // Tell every Director, in the app.
    const [student, directors, reverser] = await Promise.all([
      tx.student.findUniqueOrThrow({ where: { schoolId: actor.schoolId, id: payment.studentId } }),
      tx.membership.findMany({
        where: {
          schoolId: actor.schoolId,
          status: "active",
          roles: { some: { role: { key: "director" } } },
        },
        select: { id: true },
      }),
      tx.membership.findFirst({
        where: { schoolId: actor.schoolId, userId: actor.userId },
        select: { displayName: true },
      }),
    ]);
    if (directors.length) {
      await tx.notification.createMany({
        data: directors.map((d) => ({
          schoolId: actor.schoolId,
          membershipId: d.id,
          title: `Receipt ${payment.receipt ? receiptNo(payment.receipt.number) : ""} reversed`,
          body: `${reverser?.displayName ?? "A staff member"} reversed ${kes(payment.amountCents)} for ${student.firstName} ${student.lastName} (${student.admissionNumber}). Reason: ${reason}`,
          link: `/dashboard/fees/receipts/${payment.receipt?.id ?? ""}`,
        })),
      });
    }

    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.reversal",
      targetType: "payment",
      targetId: paymentId,
      before: { amountCents: payment.amountCents, receiptNumber: payment.receipt?.number ?? null },
      after: { reason, reversalId: reversal.id },
      ip: actor.ip,
    });
    return reversal;
  });
}
