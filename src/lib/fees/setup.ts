/**
 * Fee setup (configuration): vote heads and their priority, fee items, fee structures with
 * instalment plans, sibling discount rules and bursaries. Holders of "fees.setup" only.
 */
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf, parseDate } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";

export const DEFAULT_VOTE_HEADS = [
  "Arrears",
  "Tuition",
  "Boarding",
  "Activity",
  "Transport",
  "Uniform",
  "Exam",
  "Development",
];

type AuditBits = {
  action: string;
  targetType: string;
  targetId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

async function run<T>(
  { db }: Deps,
  actor: Actor,
  fn: (tx: Tx) => Promise<{ result: T } & AuditBits>,
) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    try {
      const r = await fn(tx);
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        before: r.before,
        after: r.after,
        ip: actor.ip,
      });
      return r.result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ValidationError("That already exists.", "name");
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ValidationError("It is already in use, so it cannot be removed.");
      }
      throw err;
    }
  });
}

function money(raw: unknown, field: string, { allowZero = false } = {}) {
  const r = parseKesToCents(raw);
  if ("error" in r || r.cents === null || r.cents < 0 || (!allowZero && r.cents === 0)) {
    throw new ValidationError("Enter an amount in shillings, for example 15000.", field);
  }
  return r.cents;
}

function percentToBp(raw: unknown, field: string) {
  const n = Number(clean(raw)?.replace("%", ""));
  if (!Number.isFinite(n) || n <= 0 || n > 100)
    throw new ValidationError("Enter a percentage from 1 to 100.", field);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getFeeSetup({ db }: Deps, actor: Actor) {
  if (
    !actor.permissions.has("fees.setup") &&
    !actor.permissions.has("fees.reports") &&
    !actor.permissions.has("fees.collect")
  ) {
    assertCan(actor.permissions, "fees.setup");
  }
  return withContext(db, ctxOf(actor), async (tx) => {
    const [voteHeads, feeItems, structures, discounts, bursaries, terms, levels] =
      await Promise.all([
        tx.voteHead.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] }),
        tx.feeItem.findMany({ include: { voteHead: true }, orderBy: { name: "asc" } }),
        tx.feeStructure.findMany({
          include: {
            term: { include: { academicYear: true } },
            level: true,
            lines: { include: { feeItem: { include: { voteHead: true } } } },
            installments: { orderBy: { dueDate: "asc" } },
          },
          orderBy: [
            { term: { startDate: "desc" } },
            { level: { sortOrder: "asc" } },
            { appliesTo: "asc" },
          ],
        }),
        tx.discountRule.findMany({
          include: { voteHead: true },
          orderBy: { siblingPosition: "asc" },
        }),
        tx.bursary.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }),
        tx.term.findMany({ include: { academicYear: true }, orderBy: { startDate: "desc" } }),
        tx.level.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }),
      ]);
    const studentIds = [...new Set(bursaries.map((b) => b.studentId))];
    const students = await tx.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    return { voteHeads, feeItems, structures, discounts, bursaries, terms, levels, students };
  });
}

// ---------------------------------------------------------------------------
// Vote heads
// ---------------------------------------------------------------------------

export async function createDefaultVoteHeads(deps: Deps, actor: Actor) {
  return run(deps, actor, async (tx) => {
    const existing = await tx.voteHead.count();
    if (existing > 0) throw new ValidationError("Vote heads are already set up.");
    await tx.voteHead.createMany({
      data: DEFAULT_VOTE_HEADS.map((name, i) => ({
        schoolId: actor.schoolId,
        name,
        priority: i + 1,
        isArrears: name === "Arrears",
      })),
    });
    // A fee item per vote head to start with (schools rename or add their own).
    const heads = await tx.voteHead.findMany();
    await tx.feeItem.createMany({
      data: heads
        .filter((h) => !h.isArrears)
        .map((h) => ({ schoolId: actor.schoolId, voteHeadId: h.id, name: `${h.name} fee` })),
    });
    return {
      result: undefined,
      action: "fees.votehead.defaults",
      targetType: "school",
      targetId: actor.schoolId,
      after: { voteHeads: DEFAULT_VOTE_HEADS },
    };
  });
}

export async function addVoteHead(deps: Deps, actor: Actor, rawName: unknown) {
  const name = clean(rawName);
  if (!name || name.length > 40) throw new ValidationError("Enter the vote head's name.", "name");
  return run(deps, actor, async (tx) => {
    const last = await tx.voteHead.aggregate({ _max: { priority: true } });
    const vh = await tx.voteHead.create({
      data: { schoolId: actor.schoolId, name, priority: (last._max.priority ?? 0) + 1 },
    });
    await tx.feeItem.create({
      data: { schoolId: actor.schoolId, voteHeadId: vh.id, name: `${name} fee` },
    });
    return {
      result: vh,
      action: "fees.votehead.add",
      targetType: "vote_head",
      targetId: vh.id,
      after: { name, priority: vh.priority },
    };
  });
}

/** Move a vote head one place up (paid earlier) or down (paid later). */
export async function moveVoteHead(
  deps: Deps,
  actor: Actor,
  voteHeadId: string,
  direction: "up" | "down",
) {
  return run(deps, actor, async (tx) => {
    const heads = await tx.voteHead.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] });
    const i = heads.findIndex((h) => h.id === voteHeadId);
    if (i < 0) throw new ValidationError("Vote head not found.");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= heads.length)
      return {
        result: undefined,
        action: "fees.votehead.priority",
        targetType: "vote_head",
        targetId: voteHeadId,
      };
    const order = [...heads];
    [order[i], order[j]] = [order[j], order[i]];
    for (const [k, h] of order.entries()) {
      if (h.priority !== k + 1)
        await tx.voteHead.update({ where: { id: h.id }, data: { priority: k + 1 } });
    }
    return {
      result: undefined,
      action: "fees.votehead.priority",
      targetType: "vote_head",
      targetId: voteHeadId,
      before: { order: heads.map((h) => h.name) },
      after: { order: order.map((h) => h.name) },
    };
  });
}

export async function addFeeItem(
  deps: Deps,
  actor: Actor,
  raw: { name: unknown; voteHeadId: unknown },
) {
  const name = clean(raw.name);
  if (!name) throw new ValidationError("Enter the fee item's name.", "name");
  return run(deps, actor, async (tx) => {
    const vh = await tx.voteHead.findUnique({ where: { id: String(raw.voteHeadId ?? "") } });
    if (!vh) throw new ValidationError("Choose a vote head.", "voteHeadId");
    const item = await tx.feeItem.create({
      data: { schoolId: actor.schoolId, voteHeadId: vh.id, name },
    });
    return {
      result: item,
      action: "fees.item.add",
      targetType: "fee_item",
      targetId: item.id,
      after: { name, voteHead: vh.name },
    };
  });
}

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------

export type StructureInput = {
  termId: string;
  levelId: string;
  appliesTo: "boarder" | "day";
  /** feeItemId -> amount (shillings text) */
  amounts: Record<string, unknown>;
  /** dueDate (YYYY-MM-DD) and percentage */
  installments: { dueDate: unknown; percent: unknown }[];
};

/** Create or replace a fee structure (only while the term has no invoices for it). */
export async function saveFeeStructure(deps: Deps, actor: Actor, input: StructureInput) {
  if (input.appliesTo !== "boarder" && input.appliesTo !== "day") {
    throw new ValidationError("Choose boarder or day scholar.", "appliesTo");
  }
  const lines = Object.entries(input.amounts)
    .filter(([, v]) => clean(v))
    .map(([feeItemId, v]) => ({
      feeItemId,
      amountCents: money(v, `amount_${feeItemId}`, { allowZero: true }),
    }))
    .filter((l) => l.amountCents > 0);
  if (lines.length === 0) throw new ValidationError("Enter at least one amount.");

  const installments = input.installments
    .filter((i) => clean(i.dueDate) || clean(i.percent))
    .map((i, k) => {
      const dueDate = parseDate(i.dueDate);
      if (!dueDate)
        throw new ValidationError(`Enter the due date of instalment ${k + 1}.`, "installments");
      return { dueDate, percentBp: percentToBp(i.percent, "installments") };
    });
  if (installments.length && installments.reduce((n, i) => n + i.percentBp, 0) !== 10_000) {
    throw new ValidationError("Instalment percentages must add up to 100%.", "installments");
  }

  return run(deps, actor, async (tx) => {
    const [term, level] = await Promise.all([
      tx.term.findUnique({ where: { id: input.termId } }),
      tx.level.findUnique({ where: { id: input.levelId } }),
    ]);
    if (!term) throw new ValidationError("Choose a term.", "termId");
    if (!level || !level.enabled)
      throw new ValidationError("Choose a level your school offers.", "levelId");
    const items = await tx.feeItem.findMany({
      where: { id: { in: lines.map((l) => l.feeItemId) } },
    });
    if (items.length !== lines.length) throw new ValidationError("Unknown fee item.");

    const existing = await tx.feeStructure.findUnique({
      where: {
        termId_levelId_appliesTo: {
          termId: term.id,
          levelId: level.id,
          appliesTo: input.appliesTo,
        },
      },
      include: { lines: true },
    });
    if (existing) {
      const invoiced = await tx.invoice.count({ where: { feeStructureId: existing.id } });
      if (invoiced > 0) {
        throw new ValidationError(
          "Invoices were already generated from this fee structure. Add one-off charges instead.",
        );
      }
      await tx.feeStructureLine.deleteMany({ where: { feeStructureId: existing.id } });
      await tx.feeInstallment.deleteMany({ where: { feeStructureId: existing.id } });
    }
    const structure =
      existing ??
      (await tx.feeStructure.create({
        data: {
          schoolId: actor.schoolId,
          termId: term.id,
          levelId: level.id,
          appliesTo: input.appliesTo,
        },
      }));
    await tx.feeStructureLine.createMany({
      data: lines.map((l) => ({ schoolId: actor.schoolId, feeStructureId: structure.id, ...l })),
    });
    if (installments.length) {
      await tx.feeInstallment.createMany({
        data: installments.map((i) => ({
          schoolId: actor.schoolId,
          feeStructureId: structure.id,
          ...i,
        })),
      });
    }
    return {
      result: structure,
      action: existing ? "fees.structure.update" : "fees.structure.create",
      targetType: "fee_structure",
      targetId: structure.id,
      before: existing
        ? {
            lines: existing.lines.map((l) => ({
              feeItemId: l.feeItemId,
              amountCents: l.amountCents,
            })),
          }
        : undefined,
      after: {
        term: term.name,
        level: level.name,
        appliesTo: input.appliesTo,
        lines,
        installments: installments.map((i) => ({
          dueDate: i.dueDate.toISOString().slice(0, 10),
          percentBp: i.percentBp,
        })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Discounts and bursaries
// ---------------------------------------------------------------------------

export async function addSiblingDiscount(
  deps: Deps,
  actor: Actor,
  raw: { name: unknown; siblingPosition: unknown; percent: unknown; voteHeadId: unknown },
) {
  const name = clean(raw.name);
  if (!name) throw new ValidationError("Name the discount.", "name");
  const siblingPosition = Number(clean(raw.siblingPosition));
  if (!Number.isInteger(siblingPosition) || siblingPosition < 2 || siblingPosition > 10) {
    throw new ValidationError(
      "Choose from which child the discount applies (2nd child or later).",
      "siblingPosition",
    );
  }
  const percentBp = percentToBp(raw.percent, "percent");
  return run(deps, actor, async (tx) => {
    const vh = await tx.voteHead.findUnique({ where: { id: String(raw.voteHeadId ?? "") } });
    if (!vh)
      throw new ValidationError("Choose the vote head the discount applies to.", "voteHeadId");
    const rule = await tx.discountRule.create({
      data: { schoolId: actor.schoolId, name, siblingPosition, percentBp, voteHeadId: vh.id },
    });
    return {
      result: rule,
      action: "fees.discount.add",
      targetType: "discount_rule",
      targetId: rule.id,
      after: { name, siblingPosition, percentBp, voteHead: vh.name },
    };
  });
}

export async function setDiscountActive(deps: Deps, actor: Actor, ruleId: string, active: boolean) {
  return run(deps, actor, async (tx) => {
    const rule = await tx.discountRule.update({ where: { id: ruleId }, data: { active } });
    return {
      result: rule,
      action: active ? "fees.discount.on" : "fees.discount.off",
      targetType: "discount_rule",
      targetId: ruleId,
    };
  });
}

export async function addBursary(
  deps: Deps,
  actor: Actor,
  raw: {
    admissionNumber: unknown;
    kind: unknown;
    sponsorName: unknown;
    coverage: unknown;
    percent?: unknown;
    amount?: unknown;
    termId?: unknown;
    voteHeadId?: unknown;
  },
) {
  const kind = raw.kind === "scholarship" ? "scholarship" : "bursary";
  const sponsorName = clean(raw.sponsorName);
  if (!sponsorName) throw new ValidationError("Enter the sponsor (who pays).", "sponsorName");
  const coverage = String(raw.coverage ?? "");
  if (!["full", "percent", "amount"].includes(coverage))
    throw new ValidationError("Choose full, a percentage or an amount.", "coverage");
  const percentBp = coverage === "percent" ? percentToBp(raw.percent, "percent") : null;
  const amountCents = coverage === "amount" ? money(raw.amount, "amount") : null;
  return run(deps, actor, async (tx) => {
    const admission = clean(raw.admissionNumber) ?? "";
    const student = await tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: actor.schoolId, admissionNumber: admission } },
    });
    if (!student)
      throw new ValidationError(`No student has admission number ${admission}.`, "admissionNumber");
    const termId = clean(raw.termId);
    if (termId && !(await tx.term.findUnique({ where: { id: termId } })))
      throw new ValidationError("Choose a term.", "termId");
    const voteHeadId = clean(raw.voteHeadId);
    if (voteHeadId && !(await tx.voteHead.findUnique({ where: { id: voteHeadId } })))
      throw new ValidationError("Choose a vote head.", "voteHeadId");
    const bursary = await tx.bursary.create({
      data: {
        schoolId: actor.schoolId,
        studentId: student.id,
        termId,
        kind,
        sponsorName,
        coverage,
        percentBp,
        amountCents,
        voteHeadId,
        createdById: actor.userId,
      },
    });
    return {
      result: bursary,
      action: "fees.bursary.add",
      targetType: "bursary",
      targetId: bursary.id,
      after: {
        studentId: student.id,
        kind,
        sponsorName,
        coverage,
        percentBp,
        amountCents,
        termId,
        voteHeadId,
      },
    };
  });
}

export async function endBursary(deps: Deps, actor: Actor, bursaryId: string) {
  return run(deps, actor, async (tx) => {
    const b = await tx.bursary.update({ where: { id: bursaryId }, data: { active: false } });
    return { result: b, action: "fees.bursary.end", targetType: "bursary", targetId: bursaryId };
  });
}
