/**
 * Fee reports. All read from the ledger.
 *
 * "Collected for a term" uses first-in-first-out: payments clear older bills first (opening
 * balances, then earlier terms), and only what is left counts toward the chosen term.
 */
import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf, parseDate } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import { firstMissedDueDate } from "./allocation";

const BILL_TYPES = new Set(["invoice", "charge", "discount", "bursary", "opening_balance"]);
const PAY_TYPES = new Set(["payment", "reversal", "credit_applied"]);

type LineRow = {
  student_id: string;
  vote_head_id: string | null;
  amount_cents: number;
  type: string;
  term_id: string | null;
  created_at: Date;
};

async function allLines(tx: Tx) {
  return tx.$queryRaw<LineRow[]>`
    SELECT l.student_id, l.vote_head_id, l.amount_cents, e.type::text AS type, e.term_id, e.created_at
    FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id`;
}

/** Which term a bill belongs to: its term, else the term whose dates include it. */
function termOf(row: LineRow, terms: { id: string; startDate: Date; endDate: Date }[]) {
  if (row.term_id) return row.term_id;
  if (row.type === "opening_balance") return null;
  return (
    terms.find(
      (t) =>
        row.created_at >= t.startDate &&
        row.created_at <= new Date(t.endDate.getTime() + 86_400_000),
    )?.id ?? null
  );
}

export async function collectedVsExpected({ db }: Deps, actor: Actor, termId: string) {
  assertCan(actor.permissions, "fees.reports");
  return withContext(db, ctxOf(actor), async (tx) => {
    const term = await tx.term.findUnique({
      where: { id: termId },
      include: { academicYear: true },
    });
    if (!term) throw new ValidationError("Choose a term.");
    const [terms, heads, students, lines] = await Promise.all([
      tx.term.findMany({ select: { id: true, startDate: true, endDate: true } }),
      tx.voteHead.findMany({ orderBy: { priority: "asc" } }),
      tx.student.findMany({
        select: {
          id: true,
          class: {
            select: {
              id: true,
              name: true,
              position: true,
              level: { select: { sortOrder: true } },
            },
          },
        },
      }),
      allLines(tx),
    ]);
    const startOf = new Map(terms.map((t) => [t.id, t.startDate.getTime()]));
    const tStart = term.startDate.getTime();

    // Per student and vote head: billed before the term, billed for the term, paid in total.
    type Acc = { before: number; inTerm: number; paid: number };
    const acc = new Map<string, Acc>();
    const key = (s: string, v: string | null) => `${s}|${v ?? "-"}`;
    for (const r of lines) {
      if (!r.vote_head_id) continue;
      const a = acc.get(key(r.student_id, r.vote_head_id)) ?? { before: 0, inTerm: 0, paid: 0 };
      if (BILL_TYPES.has(r.type)) {
        const t = termOf(r, terms);
        if (t === termId) a.inTerm += r.amount_cents;
        else if (t === null ? true : (startOf.get(t) ?? 0) < tStart) a.before += r.amount_cents;
      } else if (PAY_TYPES.has(r.type)) {
        a.paid -= r.amount_cents;
      }
      acc.set(key(r.student_id, r.vote_head_id), a);
    }

    const classOf = new Map(students.map((s) => [s.id, s.class]));
    const byHead = new Map<string, { expected: number; collected: number }>();
    const byClass = new Map<
      string,
      { name: string; order: number; expected: number; collected: number }
    >();
    for (const [k, a] of acc) {
      if (a.inTerm <= 0) continue;
      const [studentId, voteHeadId] = k.split("|");
      const collected = Math.max(0, Math.min(a.inTerm, a.paid - Math.max(0, a.before)));
      const h = byHead.get(voteHeadId) ?? { expected: 0, collected: 0 };
      h.expected += a.inTerm;
      h.collected += collected;
      byHead.set(voteHeadId, h);
      const cls = classOf.get(studentId);
      if (cls) {
        const c = byClass.get(cls.id) ?? {
          name: cls.name,
          order: cls.level.sortOrder * 100 + cls.position,
          expected: 0,
          collected: 0,
        };
        c.expected += a.inTerm;
        c.collected += collected;
        byClass.set(cls.id, c);
      }
    }
    const rows = (
      m: Map<string, { expected: number; collected: number }>,
      name: (id: string) => string,
    ) =>
      [...m].map(([id, v]) => ({
        id,
        name: name(id),
        expectedCents: v.expected,
        collectedCents: v.collected,
        outstandingCents: v.expected - v.collected,
      }));
    const voteHeads = rows(byHead, (id) => heads.find((h) => h.id === id)?.name ?? "?").sort(
      (a, b) =>
        (heads.find((h) => h.id === a.id)?.priority ?? 0) -
        (heads.find((h) => h.id === b.id)?.priority ?? 0),
    );
    const classes = [...byClass]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id, v]) => ({
        id,
        name: v.name,
        expectedCents: v.expected,
        collectedCents: v.collected,
        outstandingCents: v.expected - v.collected,
      }));
    const expected = voteHeads.reduce((n, r) => n + r.expectedCents, 0);
    const collected = voteHeads.reduce((n, r) => n + r.collectedCents, 0);
    return {
      term: { id: term.id, name: `${term.name} ${term.academicYear.name}` },
      totals: {
        expectedCents: expected,
        collectedCents: collected,
        outstandingCents: expected - collected,
      },
      voteHeads,
      classes,
    };
  });
}

export type DefaulterFilters = {
  termId?: string;
  classId?: string;
  minAmount?: string;
  minDaysOverdue?: string;
};

export async function defaulters(
  { db }: Deps,
  actor: Actor,
  f: DefaulterFilters,
  today = new Date(),
) {
  assertCan(actor.permissions, "fees.reports");
  const min = parseKesToCents(f.minAmount ?? "");
  const minCents = "error" in min || min.cents === null ? 1 : Math.max(1, min.cents);
  const minDays = Number(clean(f.minDaysOverdue) ?? 0) || 0;
  return withContext(db, ctxOf(actor), async (tx) => {
    const balances = await tx.$queryRaw<{ student_id: string; balance: bigint }[]>`
      SELECT student_id, sum(amount_cents) AS balance FROM ledger_lines GROUP BY student_id
      HAVING sum(amount_cents) >= ${minCents}`;
    const ids = balances.map((b) => b.student_id);
    const [students, invoices, links] = await Promise.all([
      tx.student.findMany({
        where: { id: { in: ids }, status: "active", ...(f.classId ? { classId: f.classId } : {}) },
        include: { class: true, stream: true },
      }),
      f.termId
        ? tx.invoice.findMany({ where: { termId: f.termId, studentId: { in: ids } } })
        : Promise.resolve([]),
      tx.guardianLink.findMany({
        where: { studentId: { in: ids }, receivesFees: true },
        include: { user: { select: { phone: true } } },
      }),
    ]);
    const structures = f.termId
      ? await tx.feeStructure.findMany({
          where: { termId: f.termId },
          include: { installments: true },
        })
      : [];
    // Net bill for the term per student (invoice + its discounts/bursaries).
    const termNet = f.termId
      ? await tx.$queryRaw<{ student_id: string; net: bigint }[]>`
          SELECT student_id, sum(amount_cents) AS net FROM ledger_entries
          WHERE term_id = ${f.termId}::uuid AND type IN ('invoice','discount','bursary') GROUP BY student_id`
      : [];

    const rows = students.map((s) => {
      const balance = Number(balances.find((b) => b.student_id === s.id)!.balance);
      const invoice = invoices.find((i) => i.studentId === s.id);
      const plan = invoice
        ? (structures.find((x) => x.id === invoice.feeStructureId)?.installments ?? [])
        : [];
      const net = Number(termNet.find((t) => t.student_id === s.id)?.net ?? 0);
      // FIFO: what is still owed sits on the newest bill first.
      const paidTowardTerm = net - Math.min(Math.max(balance, 0), net);
      const missed =
        invoice && plan.length ? firstMissedDueDate(net, paidTowardTerm, plan, today) : null;
      const daysOverdue = missed
        ? Math.floor((today.getTime() - missed.getTime()) / 86_400_000)
        : 0;
      return {
        studentId: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNumber: s.admissionNumber,
        className: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
        balanceCents: balance,
        daysOverdue,
        guardians: links
          .filter((l) => l.studentId === s.id)
          .map((l) => ({ name: l.name, phone: l.user.phone })),
      };
    });
    return rows
      .filter((r) => r.daysOverdue >= minDays)
      .sort((a, b) => b.balanceCents - a.balanceCents);
  });
}

/** Payments received on one day (Nairobi time), with reversals made that day. */
export async function dailyCollection({ db }: Deps, actor: Actor, rawDate: string) {
  assertCan(actor.permissions, "fees.reports");
  const d = parseDate(rawDate) ?? parseDate(new Date().toISOString().slice(0, 10))!;
  const from = new Date(d.getTime() - 3 * 3600_000); // midnight Nairobi = 21:00 UTC the day before
  const to = new Date(from.getTime() + 86_400_000);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [payments, reversals] = await Promise.all([
      tx.payment.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: { receipt: true, reversal: true },
        orderBy: { createdAt: "asc" },
      }),
      tx.reversal.findMany({
        where: { createdAt: { gte: from, lt: to } },
        include: { payment: { include: { receipt: true } } },
      }),
    ]);
    const students = await tx.student.findMany({
      where: {
        id: {
          in: [...payments.map((p) => p.studentId), ...reversals.map((r) => r.payment.studentId)],
        },
      },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    const who = (id: string) => students.find((s) => s.id === id);
    const byMethod = new Map<string, number>();
    for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    const received = payments.reduce((n, p) => n + p.amountCents, 0);
    const reversed = reversals.reduce((n, r) => n + r.payment.amountCents, 0);
    return {
      date: d.toISOString().slice(0, 10),
      payments: payments.map((p) => ({
        id: p.id,
        receiptId: p.receipt?.id ?? null,
        receiptNumber: p.receipt?.number ?? null,
        time: p.createdAt,
        student: who(p.studentId),
        method: p.method,
        reference: p.reference,
        amountCents: p.amountCents,
        reversed: !!p.reversal,
      })),
      reversals: reversals.map((r) => ({
        receiptNumber: r.payment.receipt?.number ?? null,
        amountCents: r.payment.amountCents,
        reason: r.reason,
        student: who(r.payment.studentId),
      })),
      byMethod: [...byMethod].map(([method, amountCents]) => ({ method, amountCents })),
      receivedCents: received,
      reversedCents: reversed,
      netCents: received - reversed,
    };
  });
}

// ---------------------------------------------------------------------------
// Pledges
// ---------------------------------------------------------------------------

export function pledgeStatus(
  p: { amountCents: number; dueDate: Date; createdAt: Date; cancelledAt: Date | null },
  paidSinceCents: number,
  today = new Date(),
): "kept" | "broken" | "open" | "cancelled" {
  if (p.cancelledAt) return "cancelled";
  if (paidSinceCents >= p.amountCents) return "kept";
  const endOfDue = new Date(p.dueDate.getTime() + 86_400_000);
  return today >= endOfDue ? "broken" : "open";
}

export async function listPledges({ db }: Deps, actor: Actor, today = new Date()) {
  if (!actor.permissions.has("fees.reports")) assertCan(actor.permissions, "fees.collect");
  return withContext(db, ctxOf(actor), async (tx) => {
    const pledges = await tx.pledge.findMany({ orderBy: { dueDate: "asc" } });
    const students = await tx.student.findMany({
      where: { id: { in: pledges.map((p) => p.studentId) } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    const out = [];
    for (const p of pledges) {
      const endOfDue = new Date(p.dueDate.getTime() + 86_400_000);
      const paid = await tx.payment.aggregate({
        where: {
          studentId: p.studentId,
          paidAt: { gte: p.createdAt, lt: endOfDue },
          reversal: null,
        },
        _sum: { amountCents: true },
      });
      const paidCents = paid._sum.amountCents ?? 0;
      out.push({
        ...p,
        paidCents,
        status: pledgeStatus(p, paidCents, today),
        student: students.find((s) => s.id === p.studentId),
      });
    }
    return out;
  });
}

export async function addPledge(
  { db }: Deps,
  actor: Actor,
  raw: {
    admissionNumber: unknown;
    amount: unknown;
    dueDate: unknown;
    madeBy: unknown;
    note?: unknown;
  },
) {
  assertCan(actor.permissions, "fees.collect");
  const amount = parseKesToCents(raw.amount);
  if ("error" in amount || !amount.cents || amount.cents <= 0)
    throw new ValidationError("Enter the amount promised.", "amount");
  const dueDate = parseDate(raw.dueDate);
  if (!dueDate) throw new ValidationError("Enter the date it was promised by.", "dueDate");
  const madeBy = clean(raw.madeBy);
  if (!madeBy) throw new ValidationError("Enter who made the promise.", "madeBy");
  return withContext(db, ctxOf(actor), async (tx) => {
    const admission = clean(raw.admissionNumber) ?? "";
    const student = await tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: actor.schoolId, admissionNumber: admission } },
    });
    if (!student)
      throw new ValidationError(`No student has admission number ${admission}.`, "admissionNumber");
    const pledge = await tx.pledge.create({
      data: {
        schoolId: actor.schoolId,
        studentId: student.id,
        amountCents: amount.cents!,
        dueDate,
        madeBy,
        note: clean(raw.note),
        createdById: actor.userId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.pledge.add",
      targetType: "pledge",
      targetId: pledge.id,
      after: {
        studentId: student.id,
        amountCents: amount.cents,
        dueDate: dueDate.toISOString().slice(0, 10),
        madeBy,
      },
      ip: actor.ip,
    });
    return pledge;
  });
}

export async function cancelPledge({ db }: Deps, actor: Actor, pledgeId: string) {
  assertCan(actor.permissions, "fees.collect");
  return withContext(db, ctxOf(actor), async (tx) => {
    const updated = await tx.pledge.updateMany({
      where: { id: pledgeId, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (updated.count === 0) throw new ValidationError("Pledge not found.");
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.pledge.cancel",
      targetType: "pledge",
      targetId: pledgeId,
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Excel export for the auditor
// ---------------------------------------------------------------------------

export async function exportFeesWorkbook({ db }: Deps, actor: Actor): Promise<Buffer> {
  assertCan(actor.permissions, "fees.reports");
  const data = await withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const [
        school,
        heads,
        students,
        payments,
        reversals,
        invoices,
        entries,
        mpesa,
        openings,
        pledges,
        terms,
      ] = await Promise.all([
        tx.school.findUniqueOrThrow({ where: { id: actor.schoolId } }),
        tx.voteHead.findMany({ orderBy: { priority: "asc" } }),
        tx.student.findMany({ include: { class: true, stream: true } }),
        tx.payment.findMany({
          include: { receipt: true, reversal: true },
          orderBy: { createdAt: "asc" },
        }),
        tx.reversal.findMany({
          include: { payment: { include: { receipt: true } } },
          orderBy: { createdAt: "asc" },
        }),
        tx.invoice.findMany({ orderBy: { createdAt: "asc" } }),
        tx.ledgerEntry.findMany({ include: { lines: true }, orderBy: { createdAt: "asc" } }),
        tx.mpesaTransaction.findMany({ orderBy: { createdAt: "asc" } }),
        tx.openingBalance.findMany(),
        tx.pledge.findMany(),
        tx.term.findMany({ include: { academicYear: true } }),
      ]);
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "fees.export",
        targetType: "school",
        targetId: actor.schoolId,
        ip: actor.ip,
      });
      return {
        school,
        heads,
        students,
        payments,
        reversals,
        invoices,
        entries,
        mpesa,
        openings,
        pledges,
        terms,
      };
    },
    { timeoutMs: 120_000 },
  );
  const st = new Map(data.students.map((s) => [s.id, s]));
  const vh = new Map(data.heads.map((h) => [h.id, h.name]));
  const term = new Map(data.terms.map((t) => [t.id, `${t.name} ${t.academicYear.name}`]));
  const money = (c: number) => c / 100;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kiota";
  const sheet = (
    name: string,
    columns: [string, string, number?][],
    rows: Record<string, unknown>[],
  ) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width ?? 16 }));
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    columns.forEach(([header], i) => {
      if (/KES/.test(header)) ws.getColumn(i + 1).numFmt = "#,##0.00";
    });
  };
  const studentCols = (id: string) => {
    const s = st.get(id);
    return {
      adm: s?.admissionNumber,
      student: s ? `${s.firstName} ${s.lastName}` : "",
      cls: s ? `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}` : "",
    };
  };

  const balances = new Map<string, number>();
  for (const e of data.entries)
    balances.set(e.studentId, (balances.get(e.studentId) ?? 0) + e.amountCents);

  sheet(
    "Payments",
    [
      ["Receipt no", "receipt", 12],
      ["Date", "date", 20],
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Class", "cls"],
      ["Method", "method", 10],
      ["Reference", "ref", 18],
      ["Paid by", "payer", 20],
      ["Amount KES", "amount", 14],
      ["Reversed", "reversed", 10],
    ],
    data.payments.map((p) => ({
      receipt: p.receipt?.number,
      date: p.paidAt,
      ...studentCols(p.studentId),
      method: p.method,
      ref: p.reference,
      payer: p.payerName,
      amount: money(p.amountCents),
      reversed: p.reversal ? "Yes" : "",
    })),
  );
  sheet(
    "Reversals",
    [
      ["Receipt no", "receipt", 12],
      ["Reversed at", "date", 20],
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Amount KES", "amount", 14],
      ["Reason", "reason", 40],
    ],
    data.reversals.map((r) => ({
      receipt: r.payment.receipt?.number,
      date: r.createdAt,
      ...studentCols(r.payment.studentId),
      amount: money(r.payment.amountCents),
      reason: r.reason,
    })),
  );
  sheet(
    "Invoices",
    [
      ["Term", "term", 16],
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Class", "cls"],
      ["Total KES", "total", 14],
      ["Created", "date", 20],
    ],
    data.invoices.map((i) => ({
      term: term.get(i.termId),
      ...studentCols(i.studentId),
      total: money(i.totalCents),
      date: i.createdAt,
    })),
  );
  sheet(
    "Ledger",
    [
      ["Date", "date", 20],
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Type", "type", 16],
      ["Description", "desc", 40],
      ["Vote head", "vh", 18],
      ["Amount KES", "amount", 14],
    ],
    data.entries.flatMap((e) =>
      e.lines.map((l) => ({
        date: e.createdAt,
        ...studentCols(e.studentId),
        type: e.type,
        desc: e.description,
        vh: l.voteHeadId ? vh.get(l.voteHeadId) : "Unallocated credit",
        amount: money(l.amountCents),
      })),
    ),
  );
  sheet(
    "Balances",
    [
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Class", "cls"],
      ["Status", "status", 12],
      ["Balance KES", "balance", 14],
    ],
    data.students.map((s) => ({
      ...studentCols(s.id),
      status: s.status,
      balance: money(balances.get(s.id) ?? 0),
    })),
  );
  sheet(
    "M-Pesa",
    [
      ["Received", "date", 20],
      ["Kind", "kind", 8],
      ["Transaction ID", "trans", 16],
      ["Account typed", "bill", 16],
      ["Phone", "phone", 16],
      ["Amount KES", "amount", 14],
      ["Status", "status", 18],
      ["Detail", "detail", 40],
    ],
    data.mpesa.map((m) => ({
      date: m.createdAt,
      kind: m.kind,
      trans: m.transId,
      bill: m.billRef,
      phone: m.msisdn,
      amount: m.amountCents ? money(m.amountCents) : null,
      status: m.status,
      detail: m.statusDetail,
    })),
  );
  sheet(
    "Opening balances",
    [
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Amount KES", "amount", 14],
      ["Posted", "posted", 10],
      ["Source", "source", 30],
    ],
    data.openings.map((o) => ({
      ...studentCols(o.studentId),
      amount: money(o.amountCents),
      posted: o.posted ? "Yes" : "No",
      source: o.source,
    })),
  );
  sheet(
    "Pledges",
    [
      ["Adm", "adm"],
      ["Student", "student", 24],
      ["Amount KES", "amount", 14],
      ["Due", "due", 14],
      ["Made by", "by", 20],
      ["Cancelled", "cancelled", 12],
    ],
    data.pledges.map((p) => ({
      ...studentCols(p.studentId),
      amount: money(p.amountCents),
      due: p.dueDate,
      by: p.madeBy,
      cancelled: p.cancelledAt ? "Yes" : "",
    })),
  );
  sheet(
    "Vote heads",
    [
      ["Priority", "priority", 10],
      ["Vote head", "name", 24],
    ],
    data.heads.map((h) => ({ priority: h.priority, name: h.name })),
  );

  const info = wb.addWorksheet("About");
  info.addRow([`${data.school.name}: fee records exported from Kiota`]);
  info.addRow([`Exported ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`]);
  info.addRow([
    "Amounts are in Kenya shillings. Payments, receipts and reversals are never edited or deleted in Kiota.",
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
