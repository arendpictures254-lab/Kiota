/**
 * Stores: setup (stores, items, suppliers, meals, ration scales) and the stock ledger (receive,
 * issue, transfer, adjust). Every movement is appended, valued at weighted average cost, inside a
 * per-item lock so two issues at once never double-count. Permissions are checked here; every
 * movement and change is audited.
 *
 *  stores.view     see stores (also implied by any other stores permission, and the cook)
 *  stores.receive  record deliveries       stores.issue  issue, transfer, meals, uniforms
 *  stores.adjust   adjustments (reason)    stores.setup  stores, items, suppliers, meals, rations
 *  stores.reports  reports                 stores.stocktake.approve  approve stock-takes, variances
 */
import { audit } from "@/lib/audit";
import type { PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf, parseDate } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import { nairobiDate } from "@/lib/attendance/rules";
import { type Position, UNITS, issueValueCents, packsToMilli, parseQty } from "./stock";

type Perms = ReadonlySet<PermissionKey>;
const STORE_PERMS: PermissionKey[] = [
  "stores.view",
  "stores.receive",
  "stores.issue",
  "stores.adjust",
  "stores.setup",
  "stores.reports",
  "stores.stocktake.approve",
];
export const canSeeStores = (p: Perms) => STORE_PERMS.some((k) => p.has(k));
export const canSeeKitchen = (p: Perms) => p.has("kitchen.confirm") || canSeeStores(p);
export function assertSeeStores(p: Perms) {
  if (!canSeeStores(p)) throw new ForbiddenError("stores.view");
}

export const STORE_KINDS = [
  { value: "food", label: "Food store (meals)" },
  { value: "uniform", label: "Uniform store" },
  { value: "general", label: "General store" },
  { value: "stationery", label: "Stationery" },
  { value: "other", label: "Other" },
] as const;

// ---------------------------------------------------------------------------
// Positions (always from the movements)
// ---------------------------------------------------------------------------

/** Lock one item's stock for the rest of the transaction (concurrent issues wait). */
export async function lockItem(tx: Tx, itemId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${itemId}`}))`;
}

export async function itemPosition(tx: Tx, schoolId: string, itemId: string): Promise<Position> {
  const s = await tx.stockMovement.aggregate({
    where: { schoolId, itemId },
    _sum: { quantityMilli: true, valueCents: true },
  });
  return { quantityMilli: s._sum.quantityMilli ?? 0, valueCents: s._sum.valueCents ?? 0 };
}

export async function itemPositions(tx: Tx, schoolId: string, itemIds?: string[]) {
  const rows = await tx.stockMovement.groupBy({
    by: ["itemId"],
    where: { schoolId, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
    _sum: { quantityMilli: true, valueCents: true },
  });
  return new Map<string, Position>(
    rows.map((r) => [
      r.itemId,
      { quantityMilli: r._sum.quantityMilli ?? 0, valueCents: r._sum.valueCents ?? 0 },
    ]),
  );
}

type MovementInput = {
  schoolId: string;
  storeId: string;
  itemId: string;
  kind: string;
  quantityMilli: number;
  valueCents: number;
  occurredOn: Date;
  createdById: string;
} & Partial<{
  supplierId: string | null;
  deliveryNote: string | null;
  packs: number | null;
  packSizeMilli: number | null;
  expiryDate: Date | null;
  mealIssueId: string | null;
  uniformIssueId: string | null;
  stocktakeId: string | null;
  transferId: string | null;
  issuedTo: string | null;
  reason: string | null;
}>;

/**
 * Take stock out (issue, meal, uniform, transfer, a negative adjustment): locked, refused when
 * there isn't enough, valued at weighted average cost. Returns the movement.
 */
export async function takeOut(
  tx: Tx,
  m: Omit<MovementInput, "quantityMilli" | "valueCents"> & { quantityMilli: number },
  item: { name: string; unit: string },
) {
  if (!Number.isInteger(m.quantityMilli) || m.quantityMilli <= 0)
    throw new ValidationError("Enter how much.", "quantity");
  await lockItem(tx, m.itemId);
  const onHand = await itemPosition(tx, m.schoolId, m.itemId);
  if (onHand.quantityMilli < m.quantityMilli)
    throw new ValidationError(
      `Not enough ${item.name} in stock: only ${onHand.quantityMilli / 1000} ${item.unit} on the records.`,
      "quantity",
    );
  const value = issueValueCents(onHand, m.quantityMilli);
  return tx.stockMovement.create({
    data: { ...m, quantityMilli: -m.quantityMilli, valueCents: -value },
  });
}

/** Put stock in at a given value (a delivery, a return, a transfer arriving, a positive adjustment). */
export async function putIn(tx: Tx, m: MovementInput) {
  if (!Number.isInteger(m.quantityMilli) || m.quantityMilli <= 0)
    throw new ValidationError("Enter how much.", "quantity");
  await lockItem(tx, m.itemId);
  return tx.stockMovement.create({ data: m });
}

async function findItem(tx: Tx, schoolId: string, itemId: string) {
  const item = await tx.storeItem.findFirst({
    where: { schoolId, id: itemId },
    include: { store: { select: { id: true, name: true, kind: true } } },
  });
  if (!item) throw new ValidationError("Item not found.", "itemId");
  return item;
}

const day = (raw: unknown, now: Date) => {
  const d = clean(raw) ? parseDate(raw) : nairobiDate(now);
  if (!d) throw new ValidationError("Enter the date.", "date");
  if (d > nairobiDate(now)) throw new ValidationError("The date can't be in the future.", "date");
  return d;
};

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

/**
 * Stock received from a supplier: a number of packs (a 90 kg bag) or a quantity in the base unit,
 * and the total cost (or the cost per pack / per unit).
 */
export async function receiveStock(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.receive");
  return withContext(db, ctxOf(actor), async (tx) => {
    const item = await findItem(tx, actor.schoolId, String(raw.itemId ?? ""));
    const packs = clean(raw.packs) ? Number(clean(raw.packs)) : null;
    let quantityMilli: number;
    if (packs !== null) {
      if (!item.packSizeMilli) throw new ValidationError("This item has no pack size.", "packs");
      if (!Number.isInteger(packs) || packs <= 0)
        throw new ValidationError("Enter a whole number of packs.", "packs");
      quantityMilli = packsToMilli(packs, item.packSizeMilli);
    } else {
      const q = parseQty(raw.quantity);
      if (!q || q <= 0) throw new ValidationError(`Enter how many ${item.unit}.`, "quantity");
      quantityMilli = q;
    }
    const cost = parseKesToCents(raw.cost);
    if ("error" in cost || cost.cents === null || cost.cents < 0)
      throw new ValidationError("Enter the cost in shillings.", "cost");
    const per = String(raw.costPer ?? "total");
    const totalCents =
      per === "pack" && packs !== null
        ? cost.cents * packs
        : per === "unit"
          ? Math.round((cost.cents * quantityMilli) / 1000)
          : cost.cents;
    let supplierId = clean(raw.supplierId);
    if (supplierId) {
      const s = await tx.supplier.findFirst({
        where: { schoolId: actor.schoolId, id: supplierId },
      });
      if (!s) throw new ValidationError("Choose the supplier.", "supplierId");
    } else supplierId = null;
    const expiry = clean(raw.expiryDate) ? parseDate(raw.expiryDate) : null;
    if (clean(raw.expiryDate) && !expiry)
      throw new ValidationError("Check the expiry date.", "expiryDate");
    const m = await putIn(tx, {
      schoolId: actor.schoolId,
      storeId: item.storeId,
      itemId: item.id,
      kind: "receive",
      quantityMilli,
      valueCents: totalCents,
      occurredOn: day(raw.date, now),
      supplierId,
      deliveryNote: clean(raw.deliveryNote)?.slice(0, 60) ?? null,
      packs,
      packSizeMilli: packs !== null ? item.packSizeMilli : null,
      expiryDate: expiry,
      createdById: actor.userId,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.receive",
      targetType: "store_item",
      targetId: item.id,
      after: { item: item.name, quantityMilli, valueCents: totalCents, movementId: m.id },
      ip: actor.ip,
    });
    return m;
  });
}

/** Stock issued (not for a meal or a uniform): to a department or person. */
export async function issueStock(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.issue");
  const quantity = parseQty(raw.quantity);
  const to = clean(raw.issuedTo);
  if (!to) throw new ValidationError("Say who it is issued to.", "issuedTo");
  return withContext(db, ctxOf(actor), async (tx) => {
    const item = await findItem(tx, actor.schoolId, String(raw.itemId ?? ""));
    const m = await takeOut(
      tx,
      {
        schoolId: actor.schoolId,
        storeId: item.storeId,
        itemId: item.id,
        kind: "issue",
        quantityMilli: quantity ?? 0,
        occurredOn: day(raw.date, now),
        issuedTo: to.slice(0, 80),
        createdById: actor.userId,
      },
      item,
    );
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.issue",
      targetType: "store_item",
      targetId: item.id,
      after: {
        item: item.name,
        quantityMilli: -m.quantityMilli,
        valueCents: -m.valueCents,
        issuedTo: to,
      },
      ip: actor.ip,
    });
    return m;
  });
}

/** Move stock to another store: out of one item, into the same item in the other store. */
export async function transferStock(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.issue");
  const quantity = parseQty(raw.quantity);
  return withContext(db, ctxOf(actor), async (tx) => {
    const item = await findItem(tx, actor.schoolId, String(raw.itemId ?? ""));
    const toStore = await tx.store.findFirst({
      where: { schoolId: actor.schoolId, id: String(raw.toStoreId ?? ""), active: true },
    });
    if (!toStore || toStore.id === item.storeId)
      throw new ValidationError("Choose the store it goes to.", "toStoreId");
    // The same item in the other store (made on first transfer, with the same unit).
    const target =
      (await tx.storeItem.findFirst({
        where: { schoolId: actor.schoolId, storeId: toStore.id, name: item.name, size: item.size },
      })) ??
      (await tx.storeItem.create({
        data: {
          schoolId: actor.schoolId,
          storeId: toStore.id,
          name: item.name,
          size: item.size,
          unit: item.unit,
          category: item.category,
          packName: item.packName,
          packSizeMilli: item.packSizeMilli,
          tracksExpiry: item.tracksExpiry,
          priceCents: item.priceCents,
        },
      }));
    if (target.unit !== item.unit)
      throw new ValidationError(
        `${toStore.name} counts ${item.name} in ${target.unit}.`,
        "toStoreId",
      );
    const transferId = crypto.randomUUID();
    const date = day(raw.date, now);
    const out = await takeOut(
      tx,
      {
        schoolId: actor.schoolId,
        storeId: item.storeId,
        itemId: item.id,
        kind: "transfer_out",
        quantityMilli: quantity ?? 0,
        occurredOn: date,
        transferId,
        issuedTo: toStore.name,
        createdById: actor.userId,
      },
      item,
    );
    await putIn(tx, {
      schoolId: actor.schoolId,
      storeId: toStore.id,
      itemId: target.id,
      kind: "transfer_in",
      quantityMilli: -out.quantityMilli,
      valueCents: -out.valueCents,
      occurredOn: date,
      transferId,
      createdById: actor.userId,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.transfer",
      targetType: "store_item",
      targetId: item.id,
      after: { item: item.name, quantityMilli: -out.quantityMilli, to: toStore.name, transferId },
      ip: actor.ip,
    });
  });
}

/**
 * An adjustment (breakage, spoilage, a count error): needs a reason. A loss is valued at weighted
 * average cost; a gain at the current average (or the cost given).
 */
export async function adjustStock(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.adjust");
  const reason = clean(raw.reason);
  if (!reason || reason.length < 4)
    throw new ValidationError("Say why the stock is being adjusted.", "reason");
  const quantity = parseQty(raw.quantity);
  if (!quantity) throw new ValidationError("Enter the change, e.g. -2.5 for a loss.", "quantity");
  return withContext(db, ctxOf(actor), async (tx) => {
    const item = await findItem(tx, actor.schoolId, String(raw.itemId ?? ""));
    const m = await postAdjustment(tx, actor, item, quantity, "adjust", reason, day(raw.date, now));
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.adjust",
      targetType: "store_item",
      targetId: item.id,
      after: { item: item.name, quantityMilli: quantity, valueCents: m.valueCents, reason },
      ip: actor.ip,
    });
    return m;
  });
}

/** One adjustment movement (also used when a stock-take is approved). */
export async function postAdjustment(
  tx: Tx,
  actor: Pick<Actor, "schoolId" | "userId">,
  item: { id: string; storeId: string; name: string; unit: string },
  quantityMilli: number,
  kind: "adjust" | "stocktake",
  reason: string,
  occurredOn: Date,
  stocktakeId: string | null = null,
) {
  const base = {
    schoolId: actor.schoolId,
    storeId: item.storeId,
    itemId: item.id,
    kind,
    occurredOn,
    reason: reason.slice(0, 300),
    stocktakeId,
    createdById: actor.userId,
  };
  if (quantityMilli < 0) return takeOut(tx, { ...base, quantityMilli: -quantityMilli }, item);
  await lockItem(tx, item.id);
  const onHand = await itemPosition(tx, actor.schoolId, item.id);
  // Found stock is valued at the current average cost (or the last delivery's when none is left).
  let unitCost = onHand.quantityMilli > 0 ? onHand.valueCents / onHand.quantityMilli : 0;
  if (onHand.quantityMilli <= 0) {
    const last = await tx.stockMovement.findFirst({
      where: { schoolId: actor.schoolId, itemId: item.id, kind: "receive" },
      orderBy: { createdAt: "desc" },
    });
    unitCost = last ? last.valueCents / last.quantityMilli : 0;
  }
  return putIn(tx, { ...base, quantityMilli, valueCents: Math.round(unitCost * quantityMilli) });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function listStores({ db }: Deps, actor: Actor) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  return withContext(db, ctxOf(actor), async (tx) => {
    const stores = await tx.store.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, active: true },
      select: { id: true, storeId: true, reorderLevelMilli: true },
    });
    const pos = await itemPositions(tx, actor.schoolId);
    return stores.map((s) => {
      const mine = items.filter((i) => i.storeId === s.id);
      return {
        ...s,
        items: mine.length,
        valueCents: mine.reduce((n, i) => n + (pos.get(i.id)?.valueCents ?? 0), 0),
        low: mine.filter(
          (i) =>
            i.reorderLevelMilli > 0 && (pos.get(i.id)?.quantityMilli ?? 0) <= i.reorderLevelMilli,
        ).length,
      };
    });
  });
}

/** One store with every item and its stock. */
export async function storeStock({ db }: Deps, actor: Actor, storeId: string) {
  if (!canSeeKitchen(actor.permissions)) throw new ForbiddenError("stores.view");
  return withContext(db, ctxOf(actor), async (tx) => {
    const store = await tx.store.findFirst({ where: { schoolId: actor.schoolId, id: storeId } });
    if (!store) return null;
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, storeId },
      orderBy: [{ category: "asc" }, { name: "asc" }, { size: "asc" }],
    });
    const pos = await itemPositions(
      tx,
      actor.schoolId,
      items.map((i) => i.id),
    );
    return {
      store,
      items: items.map((i) => {
        const p = pos.get(i.id) ?? { quantityMilli: 0, valueCents: 0 };
        return {
          ...i,
          onHandMilli: p.quantityMilli,
          valueCents: p.valueCents,
          low: i.active && i.reorderLevelMilli > 0 && p.quantityMilli <= i.reorderLevelMilli,
        };
      }),
    };
  });
}

export async function itemMovements({ db }: Deps, actor: Actor, itemId: string, take = 50) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const item = await findItem(tx, actor.schoolId, itemId);
    const [movements, pos, suppliers] = await Promise.all([
      tx.stockMovement.findMany({
        where: { schoolId: actor.schoolId, itemId },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take,
      }),
      itemPosition(tx, actor.schoolId, itemId),
      tx.supplier.findMany({
        where: { schoolId: actor.schoolId },
        select: { id: true, name: true },
      }),
    ]);
    return { item, position: pos, movements, suppliers };
  });
}

export async function saveStore({ db }: Deps, actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor.permissions, "stores.setup");
  const name = clean(raw.name)?.slice(0, 40);
  if (!name) throw new ValidationError("Name the store.", "name");
  const kind = STORE_KINDS.find((k) => k.value === raw.kind)?.value ?? "general";
  return withContext(db, ctxOf(actor), async (tx) => {
    const id = clean(raw.id);
    const clash = await tx.store.findFirst({
      where: { schoolId: actor.schoolId, name, ...(id ? { NOT: { id } } : {}) },
    });
    if (clash) throw new ValidationError("There is already a store with that name.", "name");
    const count = await tx.store.count({ where: { schoolId: actor.schoolId } });
    const row = id
      ? await tx.store.update({ where: { schoolId: actor.schoolId, id }, data: { name, kind } })
      : await tx.store.create({
          data: { schoolId: actor.schoolId, name, kind, position: count + 1 },
        });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: id ? "stores.store_update" : "stores.store_create",
      targetType: "store",
      targetId: row.id,
      after: { name, kind },
      ip: actor.ip,
    });
    return row;
  });
}

/** Add or change an item (name, size, unit, category, reorder level, pack, expiry, price). */
export async function saveItem({ db }: Deps, actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor.permissions, "stores.setup");
  const name = clean(raw.name)?.slice(0, 60);
  if (!name) throw new ValidationError("Name the item.", "name");
  const unit = UNITS.find((u) => u.key === raw.unit)?.key;
  if (!unit) throw new ValidationError("Choose the unit.", "unit");
  const reorder = clean(raw.reorderLevel) ? parseQty(raw.reorderLevel) : 0;
  if (reorder === null || reorder < 0)
    throw new ValidationError("Enter the reorder level as a number.", "reorderLevel");
  const packName = clean(raw.packName)?.slice(0, 30) ?? null;
  const packSize = clean(raw.packSize) ? parseQty(raw.packSize) : null;
  if (packName && (!packSize || packSize <= 0))
    throw new ValidationError(`How many ${unit} in one ${packName}?`, "packSize");
  let priceCents: number | null = null;
  if (clean(raw.price)) {
    const p = parseKesToCents(raw.price);
    if ("error" in p || p.cents === null || p.cents < 0)
      throw new ValidationError("Enter the price in shillings.", "price");
    priceCents = p.cents;
  }
  return withContext(db, ctxOf(actor), async (tx) => {
    const id = clean(raw.id);
    const store = await tx.store.findFirst({
      where: { schoolId: actor.schoolId, id: String(raw.storeId ?? "") },
    });
    if (!store) throw new ValidationError("Store not found.");
    const size = clean(raw.size)?.slice(0, 20) ?? "";
    const clash = await tx.storeItem.findFirst({
      where: {
        schoolId: actor.schoolId,
        storeId: store.id,
        name,
        size,
        ...(id ? { NOT: { id } } : {}),
      },
    });
    if (clash) throw new ValidationError("This store already has that item.", "name");
    const data = {
      name,
      size,
      unit,
      category: clean(raw.category)?.slice(0, 40) ?? "",
      reorderLevelMilli: reorder,
      packName: packName ? packName : null,
      packSizeMilli: packName ? packSize : null,
      tracksExpiry: raw.tracksExpiry === "on" || raw.tracksExpiry === true,
      priceCents,
      active: raw.active === undefined ? true : raw.active === "on" || raw.active === true,
    };
    if (id) {
      const before = await tx.storeItem.findFirst({ where: { schoolId: actor.schoolId, id } });
      if (!before) throw new ValidationError("Item not found.");
      // The unit can't change once stock moved: every quantity on record is in it.
      if (
        before.unit !== unit &&
        (await tx.stockMovement.count({ where: { schoolId: actor.schoolId, itemId: id } }))
      )
        throw new ValidationError("The unit can't change once stock has moved.", "unit");
    }
    const row = id
      ? await tx.storeItem.update({ where: { schoolId: actor.schoolId, id }, data })
      : await tx.storeItem.create({
          data: { schoolId: actor.schoolId, storeId: store.id, ...data },
        });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: id ? "stores.item_update" : "stores.item_create",
      targetType: "store_item",
      targetId: row.id,
      after: data,
      ip: actor.ip,
    });
    return row;
  });
}

export async function listSuppliers({ db }: Deps, actor: Actor) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), (tx) =>
    tx.supplier.findMany({ where: { schoolId: actor.schoolId }, orderBy: { name: "asc" } }),
  );
}

export async function saveSupplier({ db }: Deps, actor: Actor, raw: Record<string, unknown>) {
  if (!actor.permissions.has("stores.setup") && !actor.permissions.has("stores.receive"))
    throw new ForbiddenError("stores.setup");
  const name = clean(raw.name)?.slice(0, 80);
  if (!name) throw new ValidationError("Name the supplier.", "name");
  const kra = clean(raw.kraPin)?.toUpperCase() ?? null;
  if (kra && !/^[A-Z]\d{9}[A-Z]$/.test(kra))
    throw new ValidationError("A KRA PIN looks like P051234567X.", "kraPin");
  return withContext(db, ctxOf(actor), async (tx) => {
    const id = clean(raw.id);
    const data = { name, phone: clean(raw.phone)?.slice(0, 20) ?? null, kraPin: kra };
    const row = id
      ? await tx.supplier.update({ where: { schoolId: actor.schoolId, id }, data })
      : await tx.supplier.create({ data: { schoolId: actor.schoolId, ...data } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: id ? "stores.supplier_update" : "stores.supplier_create",
      targetType: "supplier",
      targetId: row.id,
      after: data,
      ip: actor.ip,
    });
    return row;
  });
}

/** Stores settings (Director): meal variance threshold and the uniform vote head. */
export async function storesSettings({ db }: Deps, actor: Actor) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const s = await tx.schoolSettings.findUnique({ where: { schoolId: actor.schoolId } });
    const voteHeads = await tx.voteHead.findMany({
      where: { schoolId: actor.schoolId },
      select: { id: true, name: true },
      orderBy: { priority: "asc" },
    });
    return {
      mealVariancePercent: s?.mealVariancePercent ?? 10,
      uniformVoteHeadId:
        s?.uniformVoteHeadId ?? voteHeads.find((v) => /uniform/i.test(v.name))?.id ?? null,
      voteHeads,
    };
  });
}

export async function updateStoresSettings(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
) {
  if (!actor.permissions.has("stores.setup") && !actor.permissions.has("school.settings.manage"))
    throw new ForbiddenError("stores.setup");
  const pct = Number(clean(raw.mealVariancePercent));
  if (!Number.isInteger(pct) || pct < 1 || pct > 100)
    throw new ValidationError("Enter a percentage from 1 to 100.", "mealVariancePercent");
  await withContext(db, ctxOf(actor), async (tx) => {
    const vh = clean(raw.uniformVoteHeadId);
    if (vh && !(await tx.voteHead.findFirst({ where: { schoolId: actor.schoolId, id: vh } })))
      throw new ValidationError("Choose the vote head.", "uniformVoteHeadId");
    await tx.schoolSettings.update({
      where: { schoolId: actor.schoolId },
      data: { mealVariancePercent: pct, uniformVoteHeadId: vh },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "settings.stores",
      targetType: "school",
      targetId: actor.schoolId,
      after: { mealVariancePercent: pct, uniformVoteHeadId: vh },
      ip: actor.ip,
    });
  });
}
