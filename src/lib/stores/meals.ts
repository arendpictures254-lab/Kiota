/**
 * Kitchen and meals. The school sets its meals and a ration scale (per student, per item). For a
 * meal the storekeeper enters the students served (pre-filled with today's boarders present);
 * Kiota suggests quantities from the ration scale, and what was actually issued is recorded (as
 * stock movements, valued at weighted average cost). An issue more than the school's percentage
 * away from the scale is flagged to the Director and Principal: that is how waste or theft shows.
 * The cook (kitchen.confirm) sees today's issues and confirms the number served; nothing else.
 */
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { notifyStaffWith } from "@/lib/leaveout/notify";
import { type Actor, type Deps, ValidationError, clean, ctxOf, parseDate } from "@/lib/service-kit";
import { isoDay, nairobiDate } from "@/lib/attendance/rules";
import { canSeeKitchen, takeOut } from "./service";
import {
  formatQty,
  isFlagged,
  kesExact,
  parseQty,
  suggestedMilli,
  variancePermille,
} from "./stock";

/** Boarders in school today: active boarders less those out on a leave-out. */
export async function boardersPresent(tx: Tx, schoolId: string) {
  const [boarders, out] = await Promise.all([
    tx.student.count({ where: { schoolId, status: "active", boarder: true } }),
    tx.leaveout.count({ where: { schoolId, status: "out", student: { boarder: true } } }),
  ]);
  return Math.max(0, boarders - out);
}

export async function listMeals({ db }: Deps, actor: Actor) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  return withContext(db, ctxOf(actor), (tx) =>
    tx.meal.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { rations: true },
    }),
  );
}

export async function saveMeal({ db }: Deps, actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor.permissions, "stores.setup");
  const name = clean(raw.name)?.slice(0, 30);
  if (!name) throw new ValidationError("Name the meal, e.g. 10 o'clock tea.", "name");
  return withContext(db, ctxOf(actor), async (tx) => {
    const id = clean(raw.id);
    const clash = await tx.meal.findFirst({
      where: { schoolId: actor.schoolId, name, ...(id ? { NOT: { id } } : {}) },
    });
    if (clash) throw new ValidationError("There is already a meal with that name.", "name");
    const count = await tx.meal.count({ where: { schoolId: actor.schoolId } });
    const active = raw.active === undefined ? true : raw.active === "on";
    const row = id
      ? await tx.meal.update({ where: { schoolId: actor.schoolId, id }, data: { name, active } })
      : await tx.meal.create({ data: { schoolId: actor.schoolId, name, position: count + 1 } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: id ? "stores.meal_update" : "stores.meal_create",
      targetType: "meal",
      targetId: row.id,
      after: { name, active },
      ip: actor.ip,
    });
    return row;
  });
}

/** Set (or clear, with 0) one line of a meal's ration scale. */
export async function setRation(
  { db }: Deps,
  actor: Actor,
  raw: { mealId: unknown; itemId: unknown; perStudent: unknown },
) {
  assertCan(actor.permissions, "stores.setup");
  const per = parseQty(raw.perStudent);
  if (per === null || per < 0)
    throw new ValidationError("Enter the amount per student, e.g. 0.15 for 150 g.", "perStudent");
  await withContext(db, ctxOf(actor), async (tx) => {
    const meal = await tx.meal.findFirst({
      where: { schoolId: actor.schoolId, id: String(raw.mealId) },
    });
    const item = await tx.storeItem.findFirst({
      where: { schoolId: actor.schoolId, id: String(raw.itemId) },
      include: { store: true },
    });
    if (!meal || !item || item.store.kind !== "food")
      throw new ValidationError("Choose a food item.");
    const key = { schoolId: actor.schoolId, mealId: meal.id, itemId: item.id };
    if (per === 0) await tx.rationLine.deleteMany({ where: key });
    else
      await tx.rationLine.upsert({
        where: { schoolId_mealId_itemId: key },
        create: { ...key, perStudentMilli: per },
        update: { perStudentMilli: per },
      });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.ration",
      targetType: "meal",
      targetId: meal.id,
      after: { item: item.name, perStudentMilli: per },
      ip: actor.ip,
    });
  });
}

/** What the issue screen shows: the meal's ration scale for the students served, with stock. */
export async function mealPlan({ db }: Deps, actor: Actor, mealId: string, served?: number | null) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  return withContext(db, ctxOf(actor), async (tx) => {
    const meal = await tx.meal.findFirst({
      where: { schoolId: actor.schoolId, id: mealId },
      include: { rations: true },
    });
    if (!meal) return null;
    const present = await boardersPresent(tx, actor.schoolId);
    const n = served ?? present;
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, id: { in: meal.rations.map((r) => r.itemId) } },
    });
    const stock = await tx.stockMovement.groupBy({
      by: ["itemId"],
      where: { schoolId: actor.schoolId, itemId: { in: items.map((i) => i.id) } },
      _sum: { quantityMilli: true },
    });
    return {
      meal: { id: meal.id, name: meal.name },
      boardersPresent: present,
      served: n,
      lines: meal.rations
        .map((r) => {
          const item = items.find((i) => i.id === r.itemId)!;
          return {
            itemId: r.itemId,
            name: item.name,
            unit: item.unit,
            storeId: item.storeId,
            perStudentMilli: r.perStudentMilli,
            suggestedMilli: suggestedMilli(r.perStudentMilli, n),
            onHandMilli: stock.find((s) => s.itemId === r.itemId)?._sum.quantityMilli ?? 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/**
 * Record a meal's issue: one movement per item actually issued, the suggestion beside it, the
 * cost, and a variance flag (with an in-app message to the Director and Principal) when any line
 * is off by more than the school's percentage.
 */
export async function issueMeal(
  { db }: Deps,
  actor: Actor,
  input: {
    mealId: string;
    date?: unknown;
    served: unknown;
    lines: { itemId: string; actual: unknown }[];
  },
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.issue");
  const served = Number(clean(input.served));
  if (!Number.isInteger(served) || served <= 0)
    throw new ValidationError("Enter how many students were served.", "served");
  const date = clean(input.date) ? parseDate(input.date) : nairobiDate(now);
  if (!date || date > nairobiDate(now)) throw new ValidationError("Check the date.", "date");
  return withContext(db, ctxOf(actor), async (tx) => {
    const meal = await tx.meal.findFirst({
      where: { schoolId: actor.schoolId, id: input.mealId },
      include: { rations: true },
    });
    if (!meal) throw new ValidationError("Choose the meal.", "mealId");
    const settings = await tx.schoolSettings.findUnique({ where: { schoolId: actor.schoolId } });
    const threshold = settings?.mealVariancePercent ?? 10;
    const itemIds = [
      ...new Set([...meal.rations.map((r) => r.itemId), ...input.lines.map((l) => l.itemId)]),
    ];
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, id: { in: itemIds } },
      include: { store: true },
    });
    const lines = itemIds.map((itemId) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || item.store.kind !== "food")
        throw new ValidationError("Only food store items go to meals.");
      const per = meal.rations.find((r) => r.itemId === itemId)?.perStudentMilli ?? 0;
      const typed = input.lines.find((l) => l.itemId === itemId)?.actual;
      const actual = clean(typed) === null ? 0 : parseQty(typed);
      if (actual === null || actual < 0)
        throw new ValidationError(`Check the amount of ${item.name}.`, "lines");
      const suggested = suggestedMilli(per, served);
      return { item, suggested, actual, permille: variancePermille(suggested, actual) };
    });
    if (lines.every((l) => l.actual === 0))
      throw new ValidationError("Enter what was issued.", "lines");
    const flaggedLines = lines.filter((l) => isFlagged(l.permille, threshold));
    const worst = lines.reduce(
      (w, l) => (Math.abs(l.permille ?? 0) > Math.abs(w) ? (l.permille ?? 0) : w),
      0,
    );

    // The issue's id first: the stock movements point at it, then the issue is saved with its cost.
    const issueId = crypto.randomUUID();
    let cost = 0;
    const lineRows = [];
    for (const l of lines) {
      let lineCost = 0;
      if (l.actual > 0) {
        const m = await takeOut(
          tx,
          {
            schoolId: actor.schoolId,
            storeId: l.item.storeId,
            itemId: l.item.id,
            kind: "meal",
            quantityMilli: l.actual,
            occurredOn: date,
            mealIssueId: issueId,
            issuedTo: meal.name,
            createdById: actor.userId,
          },
          l.item,
        );
        lineCost = -m.valueCents;
      }
      cost += lineCost;
      lineRows.push({
        schoolId: actor.schoolId,
        mealIssueId: issueId,
        itemId: l.item.id,
        suggestedMilli: l.suggested,
        actualMilli: l.actual,
        costCents: lineCost,
        variancePermille: l.permille,
      });
    }
    const issue = await tx.mealIssue.create({
      data: {
        id: issueId,
        schoolId: actor.schoolId,
        storeId: lines[0].item.storeId,
        mealId: meal.id,
        date,
        studentsServed: served,
        costCents: cost,
        issuedById: actor.userId,
        variancePermille: worst,
        varianceStatus: flaggedLines.length ? "open" : "none",
      },
    });
    await tx.mealIssueLine.createMany({ data: lineRows });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.meal_issue",
      targetType: "meal_issue",
      targetId: issue.id,
      after: {
        meal: meal.name,
        date: isoDay(date),
        served,
        costCents: cost,
        flagged: flaggedLines.map((l) => ({
          item: l.item.name,
          suggestedMilli: l.suggested,
          actualMilli: l.actual,
          permille: l.permille,
        })),
      },
      ip: actor.ip,
    });
    if (flaggedLines.length) {
      await notifyStaffWith(tx, actor.schoolId, ["stores.stocktake.approve"], {
        title: `${meal.name}: issue differs from the ration scale`,
        body: `${isoDay(date)}, ${served} students. ${flaggedLines
          .map(
            (l) =>
              `${l.item.name}: ${formatQty(l.actual, l.item.unit)} issued, ${formatQty(l.suggested, l.item.unit)} expected (${l.permille! > 0 ? "+" : ""}${(l.permille! / 10).toFixed(1)}%)`,
          )
          .join("; ")}.`,
        link: `/dashboard/stores/meals/${issue.id}`,
      });
    }
    return { ...issue, flagged: flaggedLines.length > 0, costText: kesExact(cost) };
  });
}

/** The cook confirms how many students were actually served (nothing else changes). */
export async function confirmServed(
  { db }: Deps,
  actor: Actor,
  issueId: string,
  rawServed: unknown,
  now = new Date(),
) {
  if (!actor.permissions.has("kitchen.confirm") && !actor.permissions.has("stores.issue"))
    throw new ForbiddenError("kitchen.confirm");
  const served = Number(clean(rawServed));
  if (!Number.isInteger(served) || served < 0)
    throw new ValidationError("Enter how many were served.", "served");
  await withContext(db, ctxOf(actor), async (tx) => {
    const issue = await tx.mealIssue.findFirst({
      where: { schoolId: actor.schoolId, id: issueId },
    });
    if (!issue) throw new ValidationError("Meal issue not found.");
    await tx.mealIssue.update({
      where: { schoolId: actor.schoolId, id: issueId },
      data: { servedConfirmed: served, confirmedById: actor.userId, confirmedAt: now },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.meal_confirm",
      targetType: "meal_issue",
      targetId: issueId,
      before: { studentsServed: issue.studentsServed },
      after: { servedConfirmed: served },
      ip: actor.ip,
    });
  });
}

/** The Director or Principal has looked at a flagged issue. */
export async function reviewVariance(
  { db }: Deps,
  actor: Actor,
  issueId: string,
  rawNote: unknown,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.stocktake.approve");
  const note = clean(rawNote)?.slice(0, 300) ?? null;
  await withContext(db, ctxOf(actor), async (tx) => {
    const issue = await tx.mealIssue.findFirst({
      where: { schoolId: actor.schoolId, id: issueId },
    });
    if (!issue || issue.varianceStatus !== "open") throw new ValidationError("Nothing to review.");
    await tx.mealIssue.update({
      where: { schoolId: actor.schoolId, id: issueId },
      data: {
        varianceStatus: "reviewed",
        reviewedById: actor.userId,
        reviewedAt: now,
        reviewNote: note,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.variance_review",
      targetType: "meal_issue",
      targetId: issueId,
      after: { note },
      ip: actor.ip,
    });
  });
}

/** One meal issue with its lines (the detail page, and the cook's view). */
export async function mealIssueDetail({ db }: Deps, actor: Actor, issueId: string) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  return withContext(db, ctxOf(actor), async (tx) => {
    const issue = await tx.mealIssue.findFirst({
      where: { schoolId: actor.schoolId, id: issueId },
      include: { meal: true, lines: true },
    });
    if (!issue) return null;
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, id: { in: issue.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, unit: true },
    });
    const people = await tx.membership.findMany({
      where: {
        schoolId: actor.schoolId,
        userId: {
          in: [issue.issuedById, issue.confirmedById, issue.reviewedById].filter(
            (x): x is string => !!x,
          ),
        },
      },
      select: { userId: true, displayName: true },
    });
    const who = (id: string | null) => people.find((p) => p.userId === id)?.displayName ?? null;
    return {
      ...issue,
      issuedBy: who(issue.issuedById),
      confirmedBy: who(issue.confirmedById),
      reviewedBy: who(issue.reviewedById),
      lines: issue.lines.map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId)! })),
    };
  });
}

/** Today's (or a day's) meal issues: the cook's screen and the storekeeper's list. */
export async function mealIssuesOn(
  { db }: Deps,
  actor: Actor,
  date?: Date | null,
  now = new Date(),
) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  const d = date ?? nairobiDate(now);
  return withContext(db, ctxOf(actor), async (tx) => {
    const issues = await tx.mealIssue.findMany({
      where: { schoolId: actor.schoolId, date: d },
      include: { meal: true, lines: true },
      orderBy: [{ meal: { position: "asc" } }, { createdAt: "asc" }],
    });
    const items = await tx.storeItem.findMany({
      where: {
        schoolId: actor.schoolId,
        id: { in: issues.flatMap((i) => i.lines.map((l) => l.itemId)) },
      },
      select: { id: true, name: true, unit: true },
    });
    return {
      date: d,
      boardersPresent: await boardersPresent(tx, actor.schoolId),
      issues: issues.map((i) => ({
        ...i,
        lines: i.lines.map((l) => ({ ...l, item: items.find((x) => x.id === l.itemId)! })),
      })),
    };
  });
}
