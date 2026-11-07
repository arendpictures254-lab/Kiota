/**
 * Stock-takes. The storekeeper starts one for a store, counts on a phone or tablet (items grouped
 * by shelf), and submits: Kiota then records what the books said and the value of each
 * difference. The Director or Principal approves (posting one adjustment per difference, with the
 * stock-take as the reason) or rejects. Nothing changes until approval.
 */
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { nairobiDate } from "@/lib/attendance/rules";
import { assertSeeStores, itemPositions, postAdjustment } from "./service";
import { issueValueCents, parseQty } from "./stock";

const canCount = (p: Actor["permissions"]) => p.has("stores.adjust") || p.has("stores.issue");

export async function startStocktake({ db }: Deps, actor: Actor, storeId: string) {
  if (!canCount(actor.permissions)) throw new ForbiddenError("stores.adjust");
  return withContext(db, ctxOf(actor), async (tx) => {
    const store = await tx.store.findFirst({ where: { schoolId: actor.schoolId, id: storeId } });
    if (!store) throw new ValidationError("Store not found.");
    const open = await tx.stocktake.findFirst({
      where: { schoolId: actor.schoolId, storeId, status: { in: ["counting", "submitted"] } },
    });
    if (open) return open;
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, storeId, active: true },
      select: { id: true },
    });
    const st = await tx.stocktake.create({
      data: { schoolId: actor.schoolId, storeId, status: "counting", startedById: actor.userId },
    });
    await tx.stocktakeLine.createMany({
      data: items.map((i) => ({ schoolId: actor.schoolId, stocktakeId: st.id, itemId: i.id })),
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.stocktake_start",
      targetType: "stocktake",
      targetId: st.id,
      after: { store: store.name, items: items.length },
      ip: actor.ip,
    });
    return st;
  });
}

/** Save counts as they are typed (several saves are fine while counting). */
export async function saveCounts(
  { db }: Deps,
  actor: Actor,
  stocktakeId: string,
  counts: Record<string, unknown>,
) {
  if (!canCount(actor.permissions)) throw new ForbiddenError("stores.adjust");
  await withContext(db, ctxOf(actor), async (tx) => {
    const st = await tx.stocktake.findFirst({
      where: { schoolId: actor.schoolId, id: stocktakeId },
    });
    if (!st || st.status !== "counting")
      throw new ValidationError("This stock-take is no longer being counted.");
    const lines = await tx.stocktakeLine.findMany({
      where: { schoolId: actor.schoolId, stocktakeId },
    });
    for (const l of lines) {
      if (!(l.itemId in counts)) continue;
      const raw = counts[l.itemId];
      const q = clean(raw) === null ? null : parseQty(raw);
      if (clean(raw) !== null && (q === null || q < 0))
        throw new ValidationError("Counts are numbers (0 or more).", l.itemId);
      if (q !== l.countedMilli)
        await tx.stocktakeLine.update({
          where: { id: l.id, schoolId: actor.schoolId },
          data: { countedMilli: q },
        });
    }
  });
}

/** Submit the count: freeze what the records say and value every difference. */
export async function submitStocktake(
  { db }: Deps,
  actor: Actor,
  stocktakeId: string,
  now = new Date(),
) {
  if (!canCount(actor.permissions)) throw new ForbiddenError("stores.adjust");
  await withContext(db, ctxOf(actor), async (tx) => {
    const st = await tx.stocktake.findFirst({
      where: { schoolId: actor.schoolId, id: stocktakeId },
    });
    if (!st || st.status !== "counting")
      throw new ValidationError("This stock-take is no longer being counted.");
    const lines = await tx.stocktakeLine.findMany({
      where: { schoolId: actor.schoolId, stocktakeId },
    });
    const missing = lines.filter((l) => l.countedMilli === null).length;
    if (missing) throw new ValidationError(`${missing} item(s) not counted yet. Enter 0 for none.`);
    const pos = await itemPositions(
      tx,
      actor.schoolId,
      lines.map((l) => l.itemId),
    );
    for (const l of lines) {
      const p = pos.get(l.itemId) ?? { quantityMilli: 0, valueCents: 0 };
      const diff = l.countedMilli! - p.quantityMilli;
      const value =
        diff === 0
          ? 0
          : diff < 0
            ? -issueValueCents(p, -diff)
            : p.quantityMilli > 0
              ? Math.round((p.valueCents * diff) / p.quantityMilli)
              : 0;
      await tx.stocktakeLine.update({
        where: { id: l.id, schoolId: actor.schoolId },
        data: { expectedMilli: p.quantityMilli, valueCents: value },
      });
    }
    await tx.stocktake.update({
      where: { schoolId: actor.schoolId, id: st.id },
      data: { status: "submitted", submittedById: actor.userId, submittedAt: now },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.stocktake_submit",
      targetType: "stocktake",
      targetId: st.id,
      ip: actor.ip,
    });
  });
}

/** Approve (post the differences as adjustments) or reject (nothing changes). */
export async function decideStocktake(
  { db }: Deps,
  actor: Actor,
  stocktakeId: string,
  approve: boolean,
  rawNote: unknown,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.stocktake.approve");
  const note = clean(rawNote)?.slice(0, 300) ?? null;
  return withContext(db, ctxOf(actor), async (tx) => {
    const st = await tx.stocktake.findFirst({
      where: { schoolId: actor.schoolId, id: stocktakeId },
    });
    if (!st || st.status !== "submitted")
      throw new ValidationError("This stock-take is not waiting for approval.");
    const lines = await tx.stocktakeLine.findMany({
      where: { schoolId: actor.schoolId, stocktakeId },
    });
    let posted = 0;
    if (approve) {
      const items = await tx.storeItem.findMany({
        where: { schoolId: actor.schoolId, id: { in: lines.map((l) => l.itemId) } },
      });
      const day = nairobiDate(now);
      for (const l of lines) {
        const diff = (l.countedMilli ?? 0) - (l.expectedMilli ?? 0);
        if (diff === 0) continue;
        const item = items.find((i) => i.id === l.itemId)!;
        await postAdjustment(
          tx,
          actor,
          item,
          diff,
          "stocktake",
          `Stock-take ${day.toISOString().slice(0, 10)}${note ? `: ${note}` : ""}`,
          day,
          st.id,
        );
        posted++;
      }
    }
    await tx.stocktake.update({
      where: { schoolId: actor.schoolId, id: st.id },
      data: {
        status: approve ? "approved" : "rejected",
        decidedById: actor.userId,
        decidedAt: now,
        note,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: approve ? "stores.stocktake_approve" : "stores.stocktake_reject",
      targetType: "stocktake",
      targetId: st.id,
      after: {
        adjustments: posted,
        valueCents: lines.reduce((n, l) => n + (l.valueCents ?? 0), 0),
        note,
      },
      ip: actor.ip,
    });
    return { posted };
  });
}

/** A stock-take with its lines (counting screen and the approval view). */
export async function stocktakeDetail({ db }: Deps, actor: Actor, stocktakeId: string) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const st = await tx.stocktake.findFirst({
      where: { schoolId: actor.schoolId, id: stocktakeId },
      include: { lines: true },
    });
    if (!st) return null;
    const [store, items] = await Promise.all([
      tx.store.findFirstOrThrow({ where: { schoolId: actor.schoolId, id: st.storeId } }),
      tx.storeItem.findMany({
        where: { schoolId: actor.schoolId, id: { in: st.lines.map((l) => l.itemId) } },
        select: { id: true, name: true, size: true, unit: true, category: true },
      }),
    ]);
    const lines = st.lines
      .map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId)! }))
      .sort(
        (a, b) =>
          (a.item.category || "~").localeCompare(b.item.category || "~") ||
          a.item.name.localeCompare(b.item.name) ||
          a.item.size.localeCompare(b.item.size),
      );
    return {
      ...st,
      store,
      lines,
      totalValueCents: lines.reduce((n, l) => n + (l.valueCents ?? 0), 0),
      differences: lines.filter(
        (l) => l.expectedMilli !== null && (l.countedMilli ?? 0) !== l.expectedMilli,
      ).length,
    };
  });
}

export async function listStocktakes({ db }: Deps, actor: Actor) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const rows = await tx.stocktake.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { lines: { select: { valueCents: true, expectedMilli: true, countedMilli: true } } },
    });
    const stores = await tx.store.findMany({
      where: { schoolId: actor.schoolId },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      store: stores.find((s) => s.id === r.storeId)?.name ?? "",
      storeId: r.storeId,
      startedAt: r.startedAt,
      submittedAt: r.submittedAt,
      decidedAt: r.decidedAt,
      valueCents: r.lines.reduce((n, l) => n + (l.valueCents ?? 0), 0),
      differences: r.lines.filter(
        (l) => l.expectedMilli !== null && (l.countedMilli ?? 0) !== l.expectedMilli,
      ).length,
    }));
  });
}
