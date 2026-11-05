/**
 * Writing to the student ledger. Every function here runs inside a caller's transaction (with the
 * school's row-level-security context set) and only ever INSERTs: the ledger is append-only.
 */
import { randomUUID } from "node:crypto";
import type { LedgerEntryType } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db-core";
import {
  type Line,
  type Position,
  type VoteHeadRef,
  applyCredit,
  positionFromLines,
  rebalanceUnallocatedDebt,
  sumLines,
} from "./allocation";

export type EntryInput = {
  schoolId: string;
  studentId: string;
  type: LedgerEntryType;
  description: string;
  createdById: string;
  termId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  reversesEntryId?: string | null;
  lines: Line[];
};

/** Build the rows for one entry (id chosen here so many entries can be inserted in bulk). */
export function entryRows(e: EntryInput) {
  const id = randomUUID();
  const lines = e.lines.filter((l) => l.amountCents !== 0);
  return {
    entry: {
      id,
      schoolId: e.schoolId,
      studentId: e.studentId,
      type: e.type,
      amountCents: sumLines(lines),
      termId: e.termId ?? null,
      description: e.description.slice(0, 300),
      invoiceId: e.invoiceId ?? null,
      paymentId: e.paymentId ?? null,
      reversesEntryId: e.reversesEntryId ?? null,
      createdById: e.createdById,
    },
    lines: lines.map((l) => ({
      schoolId: e.schoolId,
      entryId: id,
      studentId: e.studentId,
      voteHeadId: l.voteHeadId,
      amountCents: l.amountCents,
    })),
  };
}

export async function postEntry(tx: Tx, e: EntryInput) {
  const rows = entryRows(e);
  await tx.ledgerEntry.create({ data: rows.entry });
  if (rows.lines.length) await tx.ledgerLine.createMany({ data: rows.lines });
  return rows.entry;
}

/** Insert many entries in a few round trips (invoice generation, imports). */
export async function postEntries(tx: Tx, entries: EntryInput[]) {
  const rows = entries.map(entryRows);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await tx.ledgerEntry.createMany({ data: chunk.map((r) => r.entry) });
    await tx.ledgerLine.createMany({ data: chunk.flatMap((r) => r.lines) });
  }
}

export async function voteHeadRefs(tx: Tx, schoolId: string): Promise<VoteHeadRef[]> {
  return tx.voteHead.findMany({
    where: { schoolId },
    select: { id: true, priority: true, name: true },
  });
}

/** A student's position from the ledger lines (never from a stored balance). */
export async function studentPosition(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<Position> {
  const rows = await tx.ledgerLine.groupBy({
    by: ["voteHeadId"],
    where: { schoolId, studentId },
    _sum: { amountCents: true },
  });
  return positionFromLines(
    rows.map((r) => ({ voteHeadId: r.voteHeadId, amountCents: r._sum.amountCents ?? 0 })),
  );
}

/** Positions of many students in one query. */
export async function studentPositions(tx: Tx, schoolId: string, studentIds: string[]) {
  const rows = await tx.ledgerLine.groupBy({
    by: ["studentId", "voteHeadId"],
    where: { schoolId, studentId: { in: studentIds } },
    _sum: { amountCents: true },
  });
  const lines = new Map<string, Line[]>();
  for (const r of rows) {
    const list = lines.get(r.studentId) ?? [];
    list.push({ voteHeadId: r.voteHeadId, amountCents: r._sum.amountCents ?? 0 });
    lines.set(r.studentId, list);
  }
  return new Map(studentIds.map((id) => [id, positionFromLines(lines.get(id) ?? [])]));
}

/** Balance = sum of the ledger. */
export async function studentBalance(tx: Tx, schoolId: string, studentId: string) {
  return (await studentPosition(tx, schoolId, studentId)).balanceCents;
}

/** After a new debit: let unallocated credit pay it (zero-sum credit_applied entry). */
export async function applyAvailableCredit(
  tx: Tx,
  ctx: { schoolId: string; userId: string },
  studentId: string,
  heads?: VoteHeadRef[],
) {
  const position = await studentPosition(tx, ctx.schoolId, studentId);
  const lines = applyCredit(position, heads ?? (await voteHeadRefs(tx, ctx.schoolId)));
  if (lines.length === 0) return null;
  return postEntry(tx, {
    schoolId: ctx.schoolId,
    studentId,
    type: "credit_applied",
    description: "Credit carried forward applied",
    createdById: ctx.userId,
    lines,
  });
}

/** After a reversal: move any debt left on the unallocated line back onto vote heads. */
export async function rebalanceAfterReversal(
  tx: Tx,
  ctx: { schoolId: string; userId: string },
  studentId: string,
) {
  const position = await studentPosition(tx, ctx.schoolId, studentId);
  if (position.unallocatedCreditCents >= 0) return null;
  const paid = await tx.ledgerLine.groupBy({
    by: ["voteHeadId"],
    where: { schoolId: ctx.schoolId, studentId, amountCents: { lt: 0 }, voteHeadId: { not: null } },
    _sum: { amountCents: true },
  });
  const paidByVoteHead = new Map(paid.map((p) => [p.voteHeadId!, -(p._sum.amountCents ?? 0)]));
  const lines = rebalanceUnallocatedDebt(
    position,
    paidByVoteHead,
    await voteHeadRefs(tx, ctx.schoolId),
  );
  if (lines.length === 0) return null;
  return postEntry(tx, {
    schoolId: ctx.schoolId,
    studentId,
    type: "credit_applied",
    description: "Reversed credit moved back to vote heads",
    createdById: ctx.userId,
    lines,
  });
}
