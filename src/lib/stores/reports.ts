/**
 * Stores reports and dashboard figures: stock on hand and value, low stock and expiring soon,
 * cost per meal and per student, variances, uniform charges and stock-take differences, plus the
 * Excel export and the daily in-app digest. All values come from the stock ledger.
 */
import ExcelJS from "exceljs";
import { ForbiddenError } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { notifyStaffWith } from "@/lib/leaveout/notify";
import { type Actor, type Deps, ctxOf } from "@/lib/service-kit";
import { isoDay, nairobiDate } from "@/lib/attendance/rules";
import { assertSeeStores, itemPositions } from "./service";
import { formatQty, remainingBatches } from "./stock";

const EXPIRY_DAYS = 14;
export const canSeeStoreReports = (p: Actor["permissions"]) =>
  p.has("stores.reports") || p.has("stores.stocktake.approve");

/** Low stock and expiring soon, for one school (inside its context). */
async function alertsIn(tx: Tx, schoolId: string, now: Date) {
  const items = await tx.storeItem.findMany({
    where: { schoolId, active: true },
    include: { store: { select: { name: true } } },
  });
  const pos = await itemPositions(tx, schoolId);
  const low = items
    .filter(
      (i) => i.reorderLevelMilli > 0 && (pos.get(i.id)?.quantityMilli ?? 0) <= i.reorderLevelMilli,
    )
    .map((i) => ({
      id: i.id,
      name: `${i.name}${i.size ? ` (${i.size})` : ""}`,
      store: i.store.name,
      storeId: i.storeId,
      unit: i.unit,
      onHandMilli: pos.get(i.id)?.quantityMilli ?? 0,
      reorderLevelMilli: i.reorderLevelMilli,
    }));
  const tracked = items.filter((i) => i.tracksExpiry && (pos.get(i.id)?.quantityMilli ?? 0) > 0);
  const receipts = tracked.length
    ? await tx.stockMovement.findMany({
        where: { schoolId, itemId: { in: tracked.map((i) => i.id) }, kind: "receive" },
        select: { id: true, itemId: true, quantityMilli: true, occurredOn: true, expiryDate: true },
      })
    : [];
  const limit = new Date(nairobiDate(now).getTime() + EXPIRY_DAYS * 86_400_000);
  const expiring = tracked.flatMap((i) =>
    remainingBatches(
      receipts.filter((r) => r.itemId === i.id),
      pos.get(i.id)!.quantityMilli,
    )
      .filter((b) => b.expiryDate && b.expiryDate <= limit)
      .map((b) => ({
        id: b.id,
        itemId: i.id,
        name: i.name,
        store: i.store.name,
        unit: i.unit,
        remainingMilli: b.remainingMilli,
        expiryDate: b.expiryDate!,
        expired: b.expiryDate! < nairobiDate(now),
      })),
  );
  return {
    low,
    expiring: expiring.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime()),
  };
}

export async function storeAlerts({ db }: Deps, actor: Actor, now = new Date()) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), (tx) => alertsIn(tx, actor.schoolId, now));
}

/** Cost per student: each day's meal cost over that day's students served (the largest meal). */
function perStudentDays(issues: { date: Date; costCents: number; studentsServed: number }[]) {
  const days = new Map<string, { cost: number; served: number }>();
  for (const i of issues) {
    const k = isoDay(i.date);
    const d = days.get(k) ?? { cost: 0, served: 0 };
    d.cost += i.costCents;
    d.served = Math.max(d.served, i.studentsServed);
    days.set(k, d);
  }
  return [...days.entries()]
    .map(([date, d]) => ({
      date,
      costCents: d.cost,
      served: d.served,
      perStudentCents: d.served ? Math.round(d.cost / d.served) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const weekStart = (d: Date) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);

/** The Director's widget: stock value, items below reorder level, this week's cost, variances. */
export async function storesWidget({ db }: Deps, actor: Actor, now = new Date()) {
  if (!canSeeStoreReports(actor.permissions) && !actor.permissions.has("stores.setup"))
    throw new ForbiddenError("stores.reports");
  return withContext(db, ctxOf(actor), async (tx) => {
    const today = nairobiDate(now);
    const monday = weekStart(today);
    const [value, alerts, weekIssues, openVariances] = await Promise.all([
      tx.stockMovement.aggregate({
        where: { schoolId: actor.schoolId },
        _sum: { valueCents: true },
      }),
      alertsIn(tx, actor.schoolId, now),
      tx.mealIssue.findMany({
        where: { schoolId: actor.schoolId, date: { gte: monday, lte: today } },
        select: { date: true, costCents: true, studentsServed: true },
      }),
      tx.mealIssue.count({ where: { schoolId: actor.schoolId, varianceStatus: "open" } }),
    ]);
    const days = perStudentDays(weekIssues);
    return {
      valueCents: value._sum.valueCents ?? 0,
      low: alerts.low,
      expiring: alerts.expiring,
      weekPerStudentCents: days.reduce((n, d) => n + d.perStudentCents, 0),
      weekDays: days.length,
      openVariances,
    };
  });
}

/**
 * Meal costs for a period: per day (cost, students, per student), per meal, the weekly trend
 * (cost per student per week) and the variance history.
 */
export async function mealCostReport(
  { db }: Deps,
  actor: Actor,
  range: { from?: Date | null; to?: Date | null },
  now = new Date(),
) {
  if (!canSeeStoreReports(actor.permissions)) throw new ForbiddenError("stores.reports");
  const to = range.to ?? nairobiDate(now);
  const from = range.from ?? new Date(to.getTime() - 27 * 86_400_000);
  return withContext(db, ctxOf(actor), async (tx) => {
    const issues = await tx.mealIssue.findMany({
      where: { schoolId: actor.schoolId, date: { gte: from, lte: to } },
      include: { meal: { select: { name: true, position: true } } },
      orderBy: { date: "asc" },
    });
    const days = perStudentDays(issues);
    const meals = new Map<
      string,
      { name: string; position: number; cost: number; served: number; count: number }
    >();
    for (const i of issues) {
      const m = meals.get(i.mealId) ?? {
        name: i.meal.name,
        position: i.meal.position,
        cost: 0,
        served: 0,
        count: 0,
      };
      m.cost += i.costCents;
      m.served += i.studentsServed;
      m.count++;
      meals.set(i.mealId, m);
    }
    const weeks = new Map<string, { perStudent: number; days: number }>();
    for (const d of days) {
      const k = isoDay(weekStart(new Date(`${d.date}T00:00:00Z`)));
      const w = weeks.get(k) ?? { perStudent: 0, days: 0 };
      w.perStudent += d.perStudentCents;
      w.days++;
      weeks.set(k, w);
    }
    const flagged = issues.filter((i) => i.varianceStatus !== "none");
    return {
      from,
      to,
      totalCents: issues.reduce((n, i) => n + i.costCents, 0),
      days,
      meals: [...meals.entries()]
        .map(([id, m]) => ({
          id,
          name: m.name,
          position: m.position,
          costCents: m.cost,
          issues: m.count,
          perStudentCents: m.served ? Math.round(m.cost / m.served) : 0,
        }))
        .sort((a, b) => a.position - b.position),
      weeks: [...weeks.entries()].map(([week, w]) => ({
        week,
        perStudentCents: w.perStudent,
        days: w.days,
      })),
      variances: flagged.map((i) => ({
        id: i.id,
        date: i.date,
        meal: i.meal.name,
        served: i.studentsServed,
        permille: i.variancePermille,
        status: i.varianceStatus,
        costCents: i.costCents,
      })),
    };
  });
}

/** Stock on hand and value per store and item. */
export async function stockOnHand({ db }: Deps, actor: Actor) {
  if (!canSeeStoreReports(actor.permissions) && !actor.permissions.has("stores.view"))
    throw new ForbiddenError("stores.reports");
  return withContext(db, ctxOf(actor), async (tx) => {
    const items = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId },
      include: { store: { select: { name: true, position: true } } },
      orderBy: [{ store: { position: "asc" } }, { name: "asc" }, { size: "asc" }],
    });
    const pos = await itemPositions(tx, actor.schoolId);
    return items.map((i) => ({
      id: i.id,
      store: i.store.name,
      name: `${i.name}${i.size ? ` (${i.size})` : ""}`,
      unit: i.unit,
      onHandMilli: pos.get(i.id)?.quantityMilli ?? 0,
      valueCents: pos.get(i.id)?.valueCents ?? 0,
      reorderLevelMilli: i.reorderLevelMilli,
    }));
  });
}

/** Movements, consumption per item, uniform issues and stock-take differences for a period. */
export async function storesLedgerReport(
  { db }: Deps,
  actor: Actor,
  range: { from?: Date | null; to?: Date | null },
  now = new Date(),
) {
  if (!canSeeStoreReports(actor.permissions)) throw new ForbiddenError("stores.reports");
  const to = range.to ?? nairobiDate(now);
  const from = range.from ?? new Date(to.getTime() - 27 * 86_400_000);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [movements, items, stores, suppliers, uniforms, stocktakes] = await Promise.all([
      tx.stockMovement.findMany({
        where: { schoolId: actor.schoolId, occurredOn: { gte: from, lte: to } },
        orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
      }),
      tx.storeItem.findMany({
        where: { schoolId: actor.schoolId },
        select: { id: true, name: true, size: true, unit: true, storeId: true },
      }),
      tx.store.findMany({ where: { schoolId: actor.schoolId }, select: { id: true, name: true } }),
      tx.supplier.findMany({
        where: { schoolId: actor.schoolId },
        select: { id: true, name: true },
      }),
      tx.uniformIssue.findMany({
        where: {
          schoolId: actor.schoolId,
          issuedAt: { gte: from, lte: new Date(to.getTime() + 86_400_000) },
        },
        include: {
          student: { select: { firstName: true, lastName: true, admissionNumber: true } },
        },
        orderBy: { issuedAt: "asc" },
      }),
      tx.stocktake.findMany({
        where: { schoolId: actor.schoolId, status: { in: ["submitted", "approved", "rejected"] } },
        include: { lines: true },
        orderBy: { startedAt: "desc" },
        take: 20,
      }),
    ]);
    const itemOf = (id: string) => items.find((i) => i.id === id);
    const label = (id: string) => {
      const i = itemOf(id);
      return i ? `${i.name}${i.size ? ` (${i.size})` : ""}` : "";
    };
    const consumption = new Map<string, { quantity: number; value: number }>();
    for (const m of movements.filter((x) => ["meal", "issue", "uniform_issue"].includes(x.kind))) {
      const c = consumption.get(m.itemId) ?? { quantity: 0, value: 0 };
      c.quantity += -m.quantityMilli;
      c.value += -m.valueCents;
      consumption.set(m.itemId, c);
    }
    return {
      from,
      to,
      movements: movements.map((m) => ({
        id: m.id,
        date: m.occurredOn,
        store: stores.find((s) => s.id === m.storeId)?.name ?? "",
        item: label(m.itemId),
        unit: itemOf(m.itemId)?.unit ?? "",
        kind: m.kind,
        quantityMilli: m.quantityMilli,
        valueCents: m.valueCents,
        supplier: suppliers.find((s) => s.id === m.supplierId)?.name ?? null,
        deliveryNote: m.deliveryNote,
        detail: m.issuedTo ?? m.reason ?? null,
      })),
      consumption: [...consumption.entries()]
        .map(([itemId, c]) => ({
          itemId,
          item: label(itemId),
          unit: itemOf(itemId)?.unit ?? "",
          quantityMilli: c.quantity,
          valueCents: c.value,
        }))
        .sort((a, b) => b.valueCents - a.valueCents),
      uniforms: uniforms.map((u) => ({
        id: u.id,
        date: u.issuedAt,
        student: `${u.student.firstName} ${u.student.lastName} (${u.student.admissionNumber})`,
        item: label(u.itemId),
        quantity: u.quantity,
        totalCents: u.totalCents,
        payment: u.payment,
        reference: u.paidReference,
        status: u.status,
      })),
      stocktakes: stocktakes.map((s) => ({
        id: s.id,
        store: stores.find((x) => x.id === s.storeId)?.name ?? "",
        status: s.status,
        submittedAt: s.submittedAt,
        lines: s.lines
          .filter((l) => (l.countedMilli ?? 0) !== (l.expectedMilli ?? 0))
          .map((l) => ({
            item: label(l.itemId),
            unit: itemOf(l.itemId)?.unit ?? "",
            expectedMilli: l.expectedMilli ?? 0,
            countedMilli: l.countedMilli ?? 0,
            valueCents: l.valueCents ?? 0,
          })),
      })),
    };
  });
}

const KIND_LABEL: Record<string, string> = {
  receive: "Received",
  issue: "Issued",
  meal: "Meal",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  adjust: "Adjustment",
  stocktake: "Stock-take",
  uniform_issue: "Uniform issue",
  uniform_return: "Uniform return",
};
export const movementLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** Everything in one workbook (stores.reports). */
export async function exportStoresWorkbook(
  deps: Deps,
  actor: Actor,
  range: { from?: Date | null; to?: Date | null },
) {
  const [onHand, ledger, meals] = await Promise.all([
    stockOnHand(deps, actor),
    storesLedgerReport(deps, actor, range),
    mealCostReport(deps, actor, range),
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kiota";
  const kes = (c: number) => Math.round(c) / 100;
  const sheet = (
    name: string,
    columns: Partial<ExcelJS.Column>[],
    rows: Record<string, unknown>[],
  ) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns;
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  sheet(
    "Stock on hand",
    [
      { header: "Store", key: "store", width: 18 },
      { header: "Item", key: "name", width: 28 },
      { header: "On hand", key: "qty", width: 16 },
      { header: "Value (KES)", key: "value", width: 14 },
      { header: "Reorder level", key: "reorder", width: 16 },
    ],
    onHand.map((i) => ({
      store: i.store,
      name: i.name,
      qty: formatQty(i.onHandMilli, i.unit),
      value: kes(i.valueCents),
      reorder: i.reorderLevelMilli ? formatQty(i.reorderLevelMilli, i.unit) : "",
    })),
  );
  sheet(
    "Movements",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Store", key: "store", width: 16 },
      { header: "Item", key: "item", width: 26 },
      { header: "Type", key: "kind", width: 14 },
      { header: "Quantity", key: "qty", width: 14 },
      { header: "Value (KES)", key: "value", width: 12 },
      { header: "Supplier", key: "supplier", width: 18 },
      { header: "Delivery note", key: "note", width: 14 },
      { header: "To / reason", key: "detail", width: 30 },
    ],
    ledger.movements.map((m) => ({
      date: isoDay(m.date),
      store: m.store,
      item: m.item,
      kind: movementLabel(m.kind),
      qty: formatQty(m.quantityMilli, m.unit),
      value: kes(m.valueCents),
      supplier: m.supplier ?? "",
      note: m.deliveryNote ?? "",
      detail: m.detail ?? "",
    })),
  );
  sheet(
    "Consumption",
    [
      { header: "Item", key: "item", width: 26 },
      { header: "Used", key: "qty", width: 16 },
      { header: "Value (KES)", key: "value", width: 14 },
    ],
    ledger.consumption.map((c) => ({
      item: c.item,
      qty: formatQty(c.quantityMilli, c.unit),
      value: kes(c.valueCents),
    })),
  );
  sheet(
    "Meal cost per day",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Cost (KES)", key: "cost", width: 12 },
      { header: "Students", key: "served", width: 10 },
      { header: "Per student (KES)", key: "per", width: 16 },
    ],
    meals.days.map((d) => ({
      date: d.date,
      cost: kes(d.costCents),
      served: d.served,
      per: kes(d.perStudentCents),
    })),
  );
  sheet(
    "Variances",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Meal", key: "meal", width: 14 },
      { header: "Students", key: "served", width: 10 },
      { header: "Largest difference", key: "pct", width: 18 },
      { header: "Status", key: "status", width: 12 },
    ],
    meals.variances.map((v) => ({
      date: isoDay(v.date),
      meal: v.meal,
      served: v.served,
      pct: `${(v.permille / 10).toFixed(1)}%`,
      status: v.status,
    })),
  );
  sheet(
    "Uniform issues",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Student", key: "student", width: 32 },
      { header: "Item", key: "item", width: 24 },
      { header: "Qty", key: "qty", width: 6 },
      { header: "Amount (KES)", key: "amount", width: 13 },
      { header: "Payment", key: "payment", width: 16 },
      { header: "Status", key: "status", width: 10 },
    ],
    ledger.uniforms.map((u) => ({
      date: isoDay(u.date),
      student: u.student,
      item: u.item,
      qty: u.quantity,
      amount: kes(u.totalCents),
      payment: u.payment === "charged" ? "Charged to fees" : `Paid (${u.reference ?? ""})`,
      status: u.status,
    })),
  );
  sheet(
    "Stock-take differences",
    [
      { header: "Store", key: "store", width: 16 },
      { header: "Submitted", key: "date", width: 12 },
      { header: "Status", key: "status", width: 10 },
      { header: "Item", key: "item", width: 26 },
      { header: "Records", key: "expected", width: 14 },
      { header: "Counted", key: "counted", width: 14 },
      { header: "Value (KES)", key: "value", width: 12 },
    ],
    ledger.stocktakes.flatMap((s) =>
      s.lines.map((l) => ({
        store: s.store,
        date: s.submittedAt ? isoDay(s.submittedAt) : "",
        status: s.status,
        item: l.item,
        expected: formatQty(l.expectedMilli, l.unit),
        counted: formatQty(l.countedMilli, l.unit),
        value: kes(l.valueCents),
      })),
    ),
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The daily in-app digest (low stock and expiring soon), to the storekeeper and Director
 * (stores.setup): made once a day per school, the first time one of them opens the dashboard.
 * No SMS for these.
 */
export async function ensureDailyDigest({ db }: Deps, actor: Actor, now = new Date()) {
  if (!actor.permissions.has("stores.setup")) return false;
  return withContext(db, ctxOf(actor), async (tx) => {
    const today = nairobiDate(now);
    const start = new Date(today.getTime() - 3 * 3600_000); // midnight in Nairobi
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stores-digest:${actor.schoolId}`}))`;
    const mine = await tx.membership.findFirst({
      where: { schoolId: actor.schoolId, userId: actor.userId },
      select: { id: true },
    });
    const sent = await tx.notification.count({
      where: {
        schoolId: actor.schoolId,
        membershipId: mine?.id ?? "",
        title: "Stores today",
        createdAt: { gte: start },
      },
    });
    if (sent) return false;
    const { low, expiring } = await alertsIn(tx, actor.schoolId, now);
    if (!low.length && !expiring.length) return false;
    const parts = [
      low.length
        ? `Below reorder level: ${low
            .slice(0, 6)
            .map((l) => `${l.name} (${formatQty(l.onHandMilli, l.unit)})`)
            .join(", ")}${low.length > 6 ? ` and ${low.length - 6} more` : ""}.`
        : null,
      expiring.length
        ? `Expiring within ${EXPIRY_DAYS} days: ${expiring
            .slice(0, 4)
            .map(
              (e) => `${e.name} ${formatQty(e.remainingMilli, e.unit)} by ${isoDay(e.expiryDate)}`,
            )
            .join(", ")}.`
        : null,
    ].filter(Boolean);
    await notifyStaffWith(tx, actor.schoolId, ["stores.setup"], {
      title: "Stores today",
      body: parts.join(" "),
      link: "/dashboard/stores",
    });
    return true;
  });
}
