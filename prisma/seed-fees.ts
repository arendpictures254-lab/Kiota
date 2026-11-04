/**
 * Development seed for fees at Bahari Academy (idempotent: skipped once vote heads exist).
 * Uses the real services, so the seeded ledger follows exactly the same rules as the app:
 * Term 1 2027 fee structures, opening balances posted, invoices with a sibling discount and
 * bursaries, a mix of M-Pesa / cash / bank payments, one reversal, suspense payments,
 * a pledge, and students who still owe (defaulters). M-Pesa runs in Simulator mode.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { BUILT_IN_ROLES } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { withContext } from "../src/lib/db-core";
import { generateTermInvoices, postOpeningBalances } from "../src/lib/fees/invoicing";
import { postPayment, recordManualPayment, reversePayment } from "../src/lib/fees/payments";
import { addPledge } from "../src/lib/fees/reports";
import {
  addBursary,
  addSiblingDiscount,
  createDefaultVoteHeads,
  saveFeeStructure,
} from "../src/lib/fees/setup";
import { saveMpesaSettings } from "../src/lib/mpesa/service";
import type { Actor } from "../src/lib/service-kit";

export async function seedFees(owner: PrismaClient, schoolId: string) {
  if ((await owner.voteHead.count({ where: { schoolId } })) > 0) return;
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    console.warn(
      "Skipping the fees seed: set CREDENTIALS_ENCRYPTION_KEY in .env (see .env.example).",
    );
    return;
  }
  const deps = { db: owner };
  const perms = (key: string) =>
    effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === key)!.permissions,
      grants: [],
    });
  const userFor = async (phone: string) =>
    (await owner.user.findUniqueOrThrow({ where: { phone } })).id;
  const bursar: Actor = {
    userId: await userFor("+254711000002"),
    schoolId,
    permissions: perms("bursar"),
  };

  await createDefaultVoteHeads(deps, bursar);
  await saveMpesaSettings(deps, bursar, {
    shortcode: "174379",
    shortcodeType: "paybill",
    environment: "simulator",
  });

  const year = await owner.academicYear.findUniqueOrThrow({
    where: { schoolId_name: { schoolId, name: "2027" } },
  });
  const term = await owner.term.findUniqueOrThrow({
    where: { academicYearId_name: { academicYearId: year.id, name: "Term 1" } },
  });
  const items = await owner.feeItem.findMany({ where: { schoolId }, include: { voteHead: true } });
  const item = (vh: string) => items.find((i) => i.voteHead.name === vh)!.id;
  const installments = [
    { dueDate: "2027-01-15", percent: "50" },
    { dueDate: "2027-02-15", percent: "30" },
    { dueDate: "2027-03-15", percent: "20" },
  ];
  const levels = await owner.level.findMany({ where: { schoolId, enabled: true } });
  const fees = {
    junior: {
      Tuition: 15000,
      Boarding: 18000,
      Activity: 2000,
      Exam: 1500,
      Development: 3000,
      Transport: 6000,
    },
    primary: {
      Tuition: 12000,
      Boarding: 16000,
      Activity: 1500,
      Exam: 1000,
      Development: 2500,
      Transport: 6000,
    },
  } as const;
  for (const level of levels) {
    const f = fees[level.key as keyof typeof fees];
    if (!f) continue;
    for (const appliesTo of ["boarder", "day"] as const) {
      const amounts: Record<string, string> = {
        [item("Tuition")]: String(f.Tuition),
        [item("Activity")]: String(f.Activity),
        [item("Exam")]: String(f.Exam),
        [item("Development")]: String(f.Development),
      };
      if (appliesTo === "boarder") amounts[item("Boarding")] = String(f.Boarding);
      else amounts[item("Transport")] = String(f.Transport);
      await saveFeeStructure(deps, bursar, {
        termId: term.id,
        levelId: level.id,
        appliesTo,
        amounts,
        installments,
      });
    }
  }

  const heads = await owner.voteHead.findMany({ where: { schoolId } });
  const tuition = heads.find((h) => h.name === "Tuition")!.id;
  await addSiblingDiscount(deps, bursar, {
    name: "Second child",
    siblingPosition: "2",
    percent: "10",
    voteHeadId: tuition,
  });

  const students = await owner.student.findMany({
    where: { schoolId },
    orderBy: { admissionNumber: "asc" },
  });
  await addBursary(deps, bursar, {
    admissionNumber: students[4].admissionNumber,
    kind: "bursary",
    sponsorName: "Kilifi County Bursary Fund",
    coverage: "percent",
    percent: "50",
  });
  await addBursary(deps, bursar, {
    admissionNumber: students[9].admissionNumber,
    kind: "scholarship",
    sponsorName: "Bahari Alumni Scholarship",
    coverage: "full",
  });

  await postOpeningBalances(deps, bursar);
  await generateTermInvoices(deps, bursar, term.id);

  // Payments: about two thirds pay something; a few overpay; the rest are defaulters.
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  let mpesaN = 0;
  for (const [i, s] of students.entries()) {
    if (i % 3 === 2) continue; // owes everything: defaulter
    const amount = [20000, 10000, 35000, 17000, 25000, 40000][i % 6] * 100;
    const method = (["mpesa", "cash", "bank", "mpesa"] as const)[i % 4];
    if (method === "mpesa") {
      const transId = `SLB${String(1000000 + ++mpesaN).slice(1)}X${i}`.slice(0, 10);
      await withContext(owner, { userId: bursar.userId, schoolId }, async (tx) => {
        const row = await tx.mpesaTransaction.create({
          data: {
            schoolId,
            kind: "c2b",
            transId,
            amountCents: amount,
            msisdn: "254712345678",
            billRef: s.admissionNumber,
            payerName: "M-PESA CUSTOMER",
            transTime: day(i % 20),
            status: "posting",
            raw: { seed: true },
          },
        });
        const { payment } = await postPayment(tx, bursar, {
          studentId: s.id,
          method: "mpesa",
          amountCents: amount,
          reference: transId,
          payerName: "M-PESA CUSTOMER",
          payerPhone: "+254712345678",
          paidAt: day(i % 20),
          mpesaTransactionId: row.id,
        });
        await tx.mpesaTransaction.update({
          where: { id: row.id },
          data: { status: "posted", studentId: s.id, paymentId: payment.id },
        });
      });
    } else {
      await recordManualPayment(deps, bursar, {
        studentId: s.id,
        method,
        amountCents: amount,
        reference: method === "bank" ? `KCB-${50000 + i}` : null,
        payerName: null,
        payerPhone: null,
        paidAt: day(i % 20),
      });
    }
  }

  // One mistake, reversed with a reason (the Director is notified).
  const cash = await owner.payment.findFirstOrThrow({
    where: { schoolId, method: "cash" },
    orderBy: { createdAt: "asc" },
  });
  await reversePayment(deps, bursar, cash.id, "Recorded twice by mistake: the parent paid once");

  // M-Pesa payments that could not be matched: waiting in suspense.
  for (const [k, ref] of ["BAH12", "FEES", "BA/2025/999"].entries()) {
    await owner.mpesaTransaction.create({
      data: {
        schoolId,
        kind: "c2b",
        transId: `SLS00000${k}X`,
        amountCents: [500000, 1250000, 300000][k],
        msisdn: "254722000111",
        billRef: ref,
        payerName: ["JOHN MWANGI", "ESTHER ACHIENG", "HASSAN ALI"][k],
        transTime: day(k + 1),
        status: "suspense",
        statusDetail: `No student with admission number "${ref}".`,
        raw: { seed: true },
      },
    });
  }

  await addPledge(deps, bursar, {
    admissionNumber: students[2].admissionNumber,
    amount: "15000",
    dueDate: "2027-01-31",
    madeBy: "Mother, by phone",
    note: "Will pay after harvest",
  });
}
