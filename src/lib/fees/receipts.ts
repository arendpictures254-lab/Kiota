/**
 * Loading receipts and statements for display, printing and PDFs.
 */
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import type { PrismaClient } from "@/generated/prisma/client";
import { type Actor, type Deps, ctxOf } from "@/lib/service-kit";
import { getStorage } from "@/lib/storage";
import { METHODS } from "./payments";

export type ReceiptView = {
  id: string | null;
  paymentId: string | null;
  number: number;
  issuedAt: Date;
  school: { name: string; shortName: string; logoKey: string | null; id: string };
  student: { name: string; admissionNumber: string; className: string };
  amountCents: number;
  method: string;
  methodLabel: string;
  reference: string | null;
  payerName: string | null;
  paidAt: Date;
  balanceAfterCents: number;
  servedBy: string | null;
  allocation: { voteHead: string; amountCents: number }[];
  reversal: { reason: string; at: Date; by: string | null } | null;
  shareToken: string | null;
};

const methodLabel = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m;

function canSeeFees(actor: Actor) {
  if (!actor.permissions.has("fees.view") && !actor.permissions.has("fees.collect")) {
    throw new ForbiddenError("fees.view");
  }
}

export async function getReceiptView(
  { db }: Deps,
  actor: Actor,
  receiptId: string,
): Promise<ReceiptView | null> {
  canSeeFees(actor);
  return withContext(db, ctxOf(actor), async (tx) => {
    const r = await tx.receipt.findUnique({
      where: { schoolId: actor.schoolId, id: receiptId },
      include: { payment: { include: { reversal: true } } },
    });
    if (!r) return null;
    const [student, school, entry, heads, members] = await Promise.all([
      tx.student.findUniqueOrThrow({
        where: { schoolId: actor.schoolId, id: r.payment.studentId },
        include: { class: true, stream: true },
      }),
      tx.school.findUniqueOrThrow({ where: { id: actor.schoolId } }),
      tx.ledgerEntry.findFirst({
        where: { schoolId: actor.schoolId, paymentId: r.paymentId, type: "payment" },
        include: { lines: true },
      }),
      tx.voteHead.findMany({ where: { schoolId: actor.schoolId } }),
      tx.membership.findMany({
        where: {
          schoolId: actor.schoolId,
          userId: { in: [r.issuedById, r.payment.reversal?.reversedById ?? r.issuedById] },
        },
        select: { userId: true, displayName: true },
      }),
    ]);
    const name = (userId: string) => members.find((m) => m.userId === userId)?.displayName ?? null;
    return {
      id: r.id,
      paymentId: r.paymentId,
      number: r.number,
      issuedAt: r.issuedAt,
      school: {
        name: school.name,
        shortName: school.shortName,
        logoKey: school.logoUrl,
        id: school.id,
      },
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        className: `${student.class.name}${student.stream ? ` ${student.stream.name}` : ""}`,
      },
      amountCents: r.payment.amountCents,
      method: r.payment.method,
      methodLabel: methodLabel(r.payment.method),
      reference: r.payment.reference,
      payerName: r.payment.payerName,
      paidAt: r.payment.paidAt,
      balanceAfterCents: r.balanceAfterCents,
      servedBy: name(r.issuedById),
      allocation: (entry?.lines ?? []).map((l) => ({
        voteHead: l.voteHeadId
          ? (heads.find((h) => h.id === l.voteHeadId)?.name ?? "Fees")
          : "Credit carried forward",
        amountCents: -l.amountCents,
      })),
      reversal: r.payment.reversal
        ? {
            reason: r.payment.reversal.reason,
            at: r.payment.reversal.createdAt,
            by: name(r.payment.reversal.reversedById),
          }
        : null,
      shareToken: r.shareToken,
    };
  });
}

/** The receipt behind a public share link (no sign-in). Limited fields; last name shortened. */
export async function getPublicReceipt(
  db: PrismaClient,
  token: string,
): Promise<ReceiptView | null> {
  if (!/^[A-Z2-9]{16}$/.test(token)) return null;
  const [row] = await db.$queryRaw<
    { data: Record<string, unknown> | null }[]
  >`SELECT app_receipt_public(${token}) AS data`;
  const d = row?.data;
  if (!d) return null;
  return {
    id: null,
    paymentId: null,
    number: Number(d.number),
    issuedAt: new Date(String(d.issuedAt)),
    school: {
      name: String(d.schoolName),
      shortName: String(d.schoolShortName),
      logoKey: (d.schoolLogoKey as string) ?? null,
      id: String(d.schoolId),
    },
    student: {
      name: String(d.studentName),
      admissionNumber: String(d.admissionNumber),
      className: String(d.className),
    },
    amountCents: Number(d.amountCents),
    method: String(d.method),
    methodLabel: methodLabel(String(d.method)),
    reference: (d.reference as string) ?? null,
    payerName: null,
    paidAt: new Date(String(d.paidAt)),
    balanceAfterCents: Number(d.balanceAfterCents),
    servedBy: null,
    allocation: [],
    reversal: d.reversed
      ? { reason: "This payment was reversed by the school.", at: new Date(), by: null }
      : null,
    shareToken: token,
  };
}

export async function schoolCrest(logoKey: string | null, schoolId: string) {
  if (!logoKey || !logoKey.startsWith(`schools/${schoolId}/`)) return null;
  const file = await getStorage().get(logoKey);
  if (!file || !["image/png", "image/jpeg"].includes(file.contentType)) return null;
  return file;
}

export type StatementView = Awaited<ReturnType<typeof getStatement>>;

/** A student's full ledger with a running balance (fee statement). */
export async function getStatement({ db }: Deps, actor: Actor, studentId: string) {
  canSeeFees(actor);
  return withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
      include: { class: true, stream: true },
    });
    if (!student) return null;
    const [school, entries, receipts] = await Promise.all([
      tx.school.findUniqueOrThrow({ where: { id: actor.schoolId } }),
      tx.ledgerEntry.findMany({
        where: { schoolId: actor.schoolId, studentId, type: { not: "credit_applied" } },
        orderBy: { createdAt: "asc" },
      }),
      tx.receipt.findMany({
        where: { schoolId: actor.schoolId, payment: { studentId } },
        select: { paymentId: true, number: true, id: true },
      }),
    ]);
    let running = 0;
    const rows = entries.map((e) => {
      running += e.amountCents;
      const receipt = e.paymentId ? receipts.find((r) => r.paymentId === e.paymentId) : undefined;
      return {
        id: e.id,
        date: e.createdAt,
        type: e.type,
        description: e.description,
        debitCents: e.amountCents > 0 ? e.amountCents : 0,
        creditCents: e.amountCents < 0 ? -e.amountCents : 0,
        balanceCents: running,
        receiptNumber: e.type === "payment" ? (receipt?.number ?? null) : null,
        receiptId: e.type === "payment" ? (receipt?.id ?? null) : null,
      };
    });
    return {
      school: { name: school.name, logoKey: school.logoUrl, id: school.id },
      student: {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        className: `${student.class.name}${student.stream ? ` ${student.stream.name}` : ""}`,
      },
      rows,
      balanceCents: running,
      totals: {
        debitCents: rows.reduce((n, r) => n + r.debitCents, 0),
        creditCents: rows.reduce((n, r) => n + r.creditCents, 0),
      },
    };
  });
}
