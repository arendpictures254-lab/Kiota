/**
 * Term invoices (with sibling discounts and bursaries), opening balances and one-off charges.
 * Every action has a preview that computes exactly what the confirm step will post.
 */
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import {
  type Line,
  type VoteHeadRef,
  applyCredit,
  creditAgainst,
  percentOf,
  positionFromLines,
  sumLines,
} from "./allocation";
import {
  type EntryInput,
  applyAvailableCredit,
  postEntries,
  postEntry,
  rebalanceAfterReversal,
  studentPositions,
  voteHeadRefs,
} from "./ledger";

// ---------------------------------------------------------------------------
// Families (for sibling discounts)
// ---------------------------------------------------------------------------

/**
 * Group students into families: two students are siblings when they share a guardian.
 * Returns studentId -> position in the family (1 = oldest), among `students`.
 */
export function familyPositions(
  students: { id: string; dateOfBirth: Date }[],
  links: { studentId: string; userId: string }[],
) {
  const parent = new Map<string, string>(students.map((s) => [s.id, s.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const byGuardian = new Map<string, string[]>();
  for (const l of links) {
    if (!parent.has(l.studentId)) continue;
    const list = byGuardian.get(l.userId) ?? [];
    list.push(l.studentId);
    byGuardian.set(l.userId, list);
  }
  for (const kids of byGuardian.values()) {
    for (const k of kids.slice(1)) parent.set(find(k), find(kids[0]));
  }
  const families = new Map<string, { id: string; dateOfBirth: Date }[]>();
  for (const s of students) {
    const root = find(s.id);
    const list = families.get(root) ?? [];
    list.push(s);
    families.set(root, list);
  }
  const position = new Map<string, number>();
  for (const kids of families.values()) {
    kids.sort(
      (a, b) => a.dateOfBirth.getTime() - b.dateOfBirth.getTime() || a.id.localeCompare(b.id),
    );
    kids.forEach((k, i) => position.set(k.id, i + 1));
  }
  return position;
}

// ---------------------------------------------------------------------------
// Term invoices
// ---------------------------------------------------------------------------

type PlannedInvoice = {
  studentId: string;
  name: string;
  admissionNumber: string;
  feeStructureId: string;
  invoiceLines: Line[];
  discount: { name: string; lines: Line[] } | null;
  bursaries: { description: string; lines: Line[] }[];
};

export type InvoicePlan = Awaited<ReturnType<typeof computeInvoicePlan>>;

async function computeInvoicePlan(tx: Tx, schoolId: string, termId: string) {
  const term = await tx.term.findUnique({
    where: { schoolId, id: termId },
    include: { academicYear: true },
  });
  if (!term) throw new ValidationError("Choose a term.");
  const [structures, students, invoiced, rules, bursaries, heads] = await Promise.all([
    tx.feeStructure.findMany({
      where: { schoolId, termId },
      include: { lines: { include: { feeItem: true } }, level: true },
    }),
    tx.student.findMany({
      where: { schoolId, status: "active", class: { level: { enabled: true } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        dateOfBirth: true,
        boarder: true,
        class: { select: { levelId: true, name: true, level: { select: { name: true } } } },
      },
    }),
    tx.invoice.findMany({ where: { schoolId, termId }, select: { studentId: true } }),
    tx.discountRule.findMany({
      where: { schoolId, active: true },
      orderBy: { siblingPosition: "desc" },
    }),
    tx.bursary.findMany({ where: { schoolId, active: true, OR: [{ termId: null }, { termId }] } }),
    voteHeadRefs(tx, schoolId),
  ]);
  const already = new Set(invoiced.map((i) => i.studentId));
  const links = await tx.guardianLink.findMany({
    where: { schoolId, studentId: { in: students.map((s) => s.id) } },
    select: { studentId: true, userId: true },
  });
  const positions = familyPositions(students, links);

  const planned: PlannedInvoice[] = [];
  const missing: { name: string; admissionNumber: string; reason: string }[] = [];
  for (const s of students) {
    if (already.has(s.id)) continue;
    const appliesTo = s.boarder ? "boarder" : "day";
    const structure = structures.find(
      (x) => x.levelId === s.class.levelId && x.appliesTo === appliesTo,
    );
    if (!structure) {
      missing.push({
        name: `${s.firstName} ${s.lastName}`,
        admissionNumber: s.admissionNumber,
        reason: `No ${appliesTo === "boarder" ? "boarder" : "day scholar"} fee structure for ${s.class.level.name}`,
      });
      continue;
    }
    const byHead = new Map<string, number>();
    for (const l of structure.lines) {
      byHead.set(l.feeItem.voteHeadId, (byHead.get(l.feeItem.voteHeadId) ?? 0) + l.amountCents);
    }
    const invoiceLines: Line[] = [...byHead].map(([voteHeadId, amountCents]) => ({
      voteHeadId,
      amountCents,
    }));

    // Sibling discount: the rule for the highest position this child reaches.
    const position = positions.get(s.id) ?? 1;
    const rule = rules.find((r) => position >= r.siblingPosition);
    let discount: PlannedInvoice["discount"] = null;
    if (rule) {
      const base = byHead.get(rule.voteHeadId) ?? 0;
      const amount = percentOf(base, rule.percentBp);
      if (amount > 0)
        discount = {
          name: rule.name,
          lines: [{ voteHeadId: rule.voteHeadId, amountCents: -amount }],
        };
    }

    // Bursaries apply to what is left after the discount.
    let remaining: Line[] = positionLines([...invoiceLines, ...(discount?.lines ?? [])]);
    const bursaryEntries: PlannedInvoice["bursaries"] = [];
    for (const b of bursaries.filter((x) => x.studentId === s.id)) {
      const scope = b.voteHeadId
        ? remaining.filter((l) => l.voteHeadId === b.voteHeadId)
        : remaining;
      const scopeTotal = sumLines(scope);
      const amount =
        b.coverage === "full"
          ? scopeTotal
          : b.coverage === "percent"
            ? percentOf(scopeTotal, b.percentBp ?? 0)
            : Math.min(b.amountCents ?? 0, scopeTotal);
      const lines = creditAgainst(amount, scope, heads);
      if (lines.length === 0) continue;
      bursaryEntries.push({
        description: `${b.kind === "scholarship" ? "Scholarship" : "Bursary"}: ${b.sponsorName}`,
        lines,
      });
      remaining = positionLines([...remaining, ...lines]);
    }

    planned.push({
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNumber: s.admissionNumber,
      feeStructureId: structure.id,
      invoiceLines,
      discount,
      bursaries: bursaryEntries,
    });
  }

  const gross = planned.reduce((n, p) => n + sumLines(p.invoiceLines), 0);
  const discounts = -planned.reduce((n, p) => n + sumLines(p.discount?.lines ?? []), 0);
  const bursaryTotal = -planned.reduce(
    (n, p) => n + p.bursaries.reduce((m, b) => m + sumLines(b.lines), 0),
    0,
  );
  return {
    term: { id: term.id, name: `${term.name} ${term.academicYear.name}` },
    planned,
    missing,
    alreadyInvoiced: already.size,
    structuresCount: structures.length,
    totals: {
      invoices: planned.length,
      grossCents: gross,
      discountCents: discounts,
      discountCount: planned.filter((p) => p.discount).length,
      bursaryCents: bursaryTotal,
      bursaryCount: planned.filter((p) => p.bursaries.length).length,
      netCents: gross - discounts - bursaryTotal,
    },
    heads,
  };
}

/** Collapse lines to one per vote head (positive amounts only). */
function positionLines(lines: Line[]): Line[] {
  const p = positionFromLines(lines);
  return [...p.byVoteHead]
    .filter(([, v]) => v > 0)
    .map(([voteHeadId, amountCents]) => ({ voteHeadId, amountCents }));
}

export async function previewTermInvoices({ db }: Deps, actor: Actor, termId: string) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(db, ctxOf(actor), (tx) => computeInvoicePlan(tx, actor.schoolId, termId));
}

export async function generateTermInvoices({ db }: Deps, actor: Actor, termId: string) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const plan = await computeInvoicePlan(tx, actor.schoolId, termId);
      if (plan.planned.length === 0)
        throw new ValidationError("There are no students left to invoice for this term.");

      const invoices = plan.planned.map((p) => ({
        id: randomUUID(),
        schoolId: actor.schoolId,
        studentId: p.studentId,
        termId,
        feeStructureId: p.feeStructureId,
        totalCents: sumLines(p.invoiceLines),
        createdById: actor.userId,
      }));
      for (let i = 0; i < invoices.length; i += 500) {
        await tx.invoice.createMany({ data: invoices.slice(i, i + 500) });
      }

      const base = { schoolId: actor.schoolId, createdById: actor.userId, termId };
      const entries: EntryInput[] = [];
      plan.planned.forEach((p, i) => {
        entries.push({
          ...base,
          studentId: p.studentId,
          type: "invoice",
          invoiceId: invoices[i].id,
          description: `${plan.term.name} fees`,
          lines: p.invoiceLines,
        });
        if (p.discount)
          entries.push({
            ...base,
            studentId: p.studentId,
            type: "discount",
            invoiceId: invoices[i].id,
            description: `Discount: ${p.discount.name}`,
            lines: p.discount.lines,
          });
        for (const b of p.bursaries)
          entries.push({
            ...base,
            studentId: p.studentId,
            type: "bursary",
            invoiceId: invoices[i].id,
            description: b.description,
            lines: b.lines,
          });
      });

      // Earlier credit (overpayments) pays the new invoices straight away.
      const positions = await studentPositions(
        tx,
        actor.schoolId,
        plan.planned.map((p) => p.studentId),
      );
      for (const p of plan.planned) {
        const own = entries.filter((e) => e.studentId === p.studentId).flatMap((e) => e.lines);
        const before = positions.get(p.studentId)!;
        const existing: Line[] = [
          ...[...before.byVoteHead].map(([voteHeadId, amountCents]) => ({
            voteHeadId,
            amountCents,
          })),
          { voteHeadId: null, amountCents: -before.unallocatedCreditCents },
        ];
        const credit = applyCredit(positionFromLines([...existing, ...own]), plan.heads);
        if (credit.length) {
          entries.push({
            schoolId: actor.schoolId,
            createdById: actor.userId,
            studentId: p.studentId,
            type: "credit_applied",
            description: "Credit carried forward applied",
            lines: credit,
          });
        }
      }
      await postEntries(tx, entries);

      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "fees.invoices.generate",
        targetType: "term",
        targetId: termId,
        after: { term: plan.term.name, ...plan.totals, skippedNoStructure: plan.missing.length },
        ip: actor.ip,
      });
      return plan.totals;
    },
    { timeoutMs: 180_000 },
  );
}

// ---------------------------------------------------------------------------
// Opening balances (from the Excel import)
// ---------------------------------------------------------------------------

async function openingPlan(tx: Tx, schoolId: string) {
  const rows = await tx.openingBalance.findMany({
    where: { schoolId, posted: false },
    include: { student: { select: { firstName: true, lastName: true, admissionNumber: true } } },
  });
  const arrears = await tx.voteHead.findFirst({
    where: { schoolId, isArrears: true },
  });
  return {
    rows,
    arrears,
    owedCents: rows.filter((r) => r.amountCents > 0).reduce((n, r) => n + r.amountCents, 0),
    creditCents: -rows.filter((r) => r.amountCents < 0).reduce((n, r) => n + r.amountCents, 0),
  };
}

export async function previewOpeningBalances({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(db, ctxOf(actor), (tx) => openingPlan(tx, actor.schoolId));
}

/** Post every unposted opening balance as the student's first ledger entry. Once only. */
export async function postOpeningBalances({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const plan = await openingPlan(tx, actor.schoolId);
      if (plan.rows.length === 0)
        throw new ValidationError("There are no opening balances waiting to be posted.");
      if (!plan.arrears)
        throw new ValidationError(
          "Set up vote heads first: opening balances go to the Arrears vote head.",
        );
      const entries: EntryInput[] = plan.rows
        .filter((r) => r.amountCents !== 0)
        .map((r) => ({
          schoolId: actor.schoolId,
          studentId: r.studentId,
          type: "opening_balance",
          description: r.amountCents > 0 ? "Opening balance (arrears)" : "Opening balance (credit)",
          createdById: actor.userId,
          lines: [
            { voteHeadId: r.amountCents > 0 ? plan.arrears!.id : null, amountCents: r.amountCents },
          ],
        }));
      await postEntries(tx, entries);
      // The staging rows are frozen from now on (a database trigger refuses later changes).
      const marked = await tx.openingBalance.updateMany({
        where: {
          schoolId: actor.schoolId,
          posted: false,
          studentId: { in: plan.rows.map((r) => r.studentId) },
        },
        data: { posted: true },
      });
      if (marked.count !== plan.rows.length)
        throw new Error("Opening balances changed while posting");
      for (const r of plan.rows) {
        await applyAvailableCredit(
          tx,
          { schoolId: actor.schoolId, userId: actor.userId },
          r.studentId,
        );
      }
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "fees.opening_balances.post",
        targetType: "school",
        targetId: actor.schoolId,
        after: {
          count: plan.rows.length,
          owedCents: plan.owedCents,
          creditCents: plan.creditCents,
        },
        ip: actor.ip,
      });
      return { count: plan.rows.length, owedCents: plan.owedCents, creditCents: plan.creditCents };
    },
    { timeoutMs: 180_000 },
  );
}

// ---------------------------------------------------------------------------
// One-off charges
// ---------------------------------------------------------------------------

export async function addCharge(
  { db }: Deps,
  actor: Actor,
  raw: {
    admissionNumber: unknown;
    voteHeadId: unknown;
    amount: unknown;
    description: unknown;
    termId?: unknown;
  },
) {
  assertCan(actor.permissions, "fees.setup");
  const description = clean(raw.description);
  if (!description)
    throw new ValidationError(
      'Say what the charge is for, for example "Trip to Mombasa".',
      "description",
    );
  const amount = parseKesToCents(raw.amount);
  if ("error" in amount || !amount.cents || amount.cents <= 0)
    throw new ValidationError("Enter the amount in shillings.", "amount");
  return withContext(db, ctxOf(actor), async (tx) => {
    const admission = clean(raw.admissionNumber) ?? "";
    const student = await tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: actor.schoolId, admissionNumber: admission } },
    });
    if (!student)
      throw new ValidationError(`No student has admission number ${admission}.`, "admissionNumber");
    const vh = await tx.voteHead.findUnique({
      where: { schoolId: actor.schoolId, id: String(raw.voteHeadId ?? "") },
    });
    if (!vh) throw new ValidationError("Choose the vote head.", "voteHeadId");
    await postCharge(tx, actor, {
      studentId: student.id,
      voteHeadId: vh.id,
      voteHeadName: vh.name,
      amountCents: amount.cents!,
      description,
      termId: clean(raw.termId),
    });
    return { studentId: student.id };
  });
}

/**
 * The one way a one-off charge reaches a student's ledger (the fees screen, and uniforms from the
 * stores): an append-only "charge" entry on one vote head, available credit applied, audited.
 * Runs in the caller's transaction; the caller has checked who may charge.
 */
export async function postCharge(
  tx: Tx,
  actor: Pick<Actor, "schoolId" | "userId" | "ip">,
  c: {
    studentId: string;
    voteHeadId: string;
    voteHeadName: string;
    amountCents: number;
    description: string;
    termId?: string | null;
  },
) {
  if (!Number.isInteger(c.amountCents) || c.amountCents <= 0)
    throw new ValidationError("A charge must be a positive amount.");
  const entry = await postEntry(tx, {
    schoolId: actor.schoolId,
    studentId: c.studentId,
    type: "charge",
    termId: c.termId ?? null,
    description: c.description,
    createdById: actor.userId,
    lines: [{ voteHeadId: c.voteHeadId, amountCents: c.amountCents }],
  });
  await applyAvailableCredit(tx, { schoolId: actor.schoolId, userId: actor.userId }, c.studentId);
  await audit(tx, {
    schoolId: actor.schoolId,
    actorId: actor.userId,
    action: "fees.charge",
    targetType: "student",
    targetId: c.studentId,
    after: {
      description: c.description,
      amountCents: c.amountCents,
      voteHead: c.voteHeadName,
      entryId: entry.id,
    },
    ip: actor.ip,
  });
  return entry;
}

/**
 * Reverse a charge (never edit it): a "reversal" entry with the opposite lines, pointing at the
 * charge, then any credit moved back and re-applied, as for payment reversals. A charge is only
 * ever reversed once.
 */
export async function reverseCharge(
  tx: Tx,
  actor: Pick<Actor, "schoolId" | "userId" | "ip">,
  entryId: string,
  reason: string,
) {
  const original = await tx.ledgerEntry.findFirst({
    where: { schoolId: actor.schoolId, id: entryId, type: "charge" },
    include: { lines: true },
  });
  if (!original) throw new ValidationError("Charge not found.");
  const already = await tx.ledgerEntry.findFirst({
    where: { schoolId: actor.schoolId, reversesEntryId: original.id },
    select: { id: true },
  });
  if (already) throw new ValidationError("This charge has already been reversed.");
  const entry = await postEntry(tx, {
    schoolId: actor.schoolId,
    studentId: original.studentId,
    type: "reversal",
    termId: original.termId,
    description: `Reversal of "${original.description}": ${reason}`,
    createdById: actor.userId,
    reversesEntryId: original.id,
    lines: original.lines.map((l) => ({ voteHeadId: l.voteHeadId, amountCents: -l.amountCents })),
  });
  const ctx = { schoolId: actor.schoolId, userId: actor.userId };
  await rebalanceAfterReversal(tx, ctx, original.studentId);
  await applyAvailableCredit(tx, ctx, original.studentId);
  await audit(tx, {
    schoolId: actor.schoolId,
    actorId: actor.userId,
    action: "fees.charge_reverse",
    targetType: "student",
    targetId: original.studentId,
    before: { entryId: original.id, amountCents: original.amountCents },
    after: { reversalEntryId: entry.id, reason },
    ip: actor.ip,
  });
  return entry;
}

export type { VoteHeadRef };
