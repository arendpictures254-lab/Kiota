import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataTable } from "@/components/data-table";
import { Card, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay, parseDay } from "@/lib/attendance/rules";
import {
  canSeeStoreReports,
  mealCostReport,
  movementLabel,
  stockOnHand,
  storesLedgerReport,
} from "@/lib/stores/reports";
import { formatQty, kesExact, kesWhole } from "@/lib/stores/stock";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Stores reports · Kiota" };

type Props = PageProps<"/dashboard/stores/reports">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function StoresReportsPage({ searchParams }: Props) {
  return (
    <StoresShell title="Stores reports">
      <Suspense fallback={<Loading />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </StoresShell>
  );
}

const TABS = [
  ["meals", "Meal costs"],
  ["stock", "Stock on hand"],
  ["movements", "Movements"],
  ["consumption", "Consumption"],
  ["uniforms", "Uniforms"],
  ["stocktakes", "Stock-takes"],
] as const;

async function Reports({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadStoresActor();
  if (!canSeeStoreReports(actor.permissions))
    return <Notice tone="error">Stores reports are for the Director, Principal and Bursar.</Notice>;
  const sp = await searchParams;
  const view = TABS.find((t) => t[0] === one(sp.view))?.[0] ?? "meals";
  const range = { from: parseDay(one(sp.from)), to: parseDay(one(sp.to)) };
  const [meals, ledger, onHand] = await Promise.all([
    mealCostReport(deps, actor, range),
    view === "meals" || view === "stock" ? null : storesLedgerReport(deps, actor, range),
    view === "stock" ? stockOnHand(deps, actor) : null,
  ]);
  const q = `from=${isoDay(meals.from)}&to=${isoDay(meals.to)}`;
  const maxWeek = Math.max(1, ...meals.weeks.map((w) => w.perStudentCents));
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-2" aria-label="Reports">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`?view=${key}&${q}`}
            aria-current={view === key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ${view === key ? "bg-teal text-white" : "bg-white text-teal"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
        {(["from", "to"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm font-semibold">
            {k === "from" ? "From" : "To"}
            <input
              type="date"
              name={k}
              defaultValue={isoDay(meals[k])}
              className="h-12 rounded-xl border border-ink/20 bg-white px-3 font-normal"
            />
          </label>
        ))}
        <button
          type="submit"
          className="h-12 rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal"
        >
          Show
        </button>
        <a
          href={`/dashboard/stores/export?${q}`}
          className="inline-flex h-12 items-center rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal hover:bg-egg-blue/30"
        >
          Export to Excel
        </a>
      </form>

      {view === "meals" ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-ink/60">Food issued for meals</p>
              <p className="font-heading text-display font-bold text-teal">
                {kesWhole(meals.totalCents)}
              </p>
              <p className="text-sm text-ink/60">{meals.days.length} days</p>
            </Card>
            <Card className="flex flex-col gap-1">
              <p className="text-sm text-ink/60">Per student per day (average)</p>
              <p className="font-heading text-display font-bold text-ink">
                {kesExact(
                  meals.days.length
                    ? Math.round(
                        meals.days.reduce((n, d) => n + d.perStudentCents, 0) / meals.days.length,
                      )
                    : 0,
                )}
              </p>
              <p className="text-sm text-ink/60">each day&apos;s cost over its students</p>
            </Card>
            <Card className="flex flex-col gap-2">
              <p className="text-sm text-ink/60">Per student per week</p>
              <ul className="flex items-end gap-2" aria-label="Cost per student per week">
                {meals.weeks.map((w) => (
                  <li key={w.week} className="flex flex-1 flex-col items-center gap-1 text-xs">
                    <span className="font-semibold">{Math.round(w.perStudentCents / 100)}</span>
                    <span
                      className="w-full rounded-t bg-teal"
                      style={{ height: `${Math.max(4, (w.perStudentCents / maxWeek) * 56)}px` }}
                      aria-hidden
                    />
                    <span className="text-ink/60">{w.week.slice(5)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="font-heading text-section font-bold">Per meal</h2>
              <DataTable
                caption="Cost per meal"
                empty="No meal issues in this period."
                columns={[
                  { key: "meal", label: "Meal" },
                  { key: "issues", label: "Times", align: "right", width: "6rem" },
                  { key: "cost", label: "Cost", align: "right", width: "9rem" },
                  { key: "per", label: "Per student", align: "right", width: "9rem" },
                ]}
                mobile={{ title: "meal", subtitle: ["cost"], value: "per" }}
                rows={meals.meals.map((m) => ({
                  id: m.id,
                  cells: {
                    meal: { node: m.name, sort: m.position },
                    issues: { node: m.issues, sort: m.issues },
                    cost: { node: kesExact(m.costCents), sort: m.costCents },
                    per: { node: kesExact(m.perStudentCents), sort: m.perStudentCents },
                  },
                }))}
              />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="font-heading text-section font-bold">Variances</h2>
              <DataTable
                caption="Meal issues away from the ration scale"
                empty="None: every issue was within the ration scale."
                columns={[
                  { key: "date", label: "Date", width: "8rem" },
                  { key: "meal", label: "Meal" },
                  { key: "pct", label: "Difference", align: "right", width: "8rem" },
                  { key: "status", label: "Status", width: "8rem" },
                ]}
                mobile={{ title: "meal", subtitle: ["date", "status"], value: "pct" }}
                rows={meals.variances.map((v) => ({
                  id: v.id,
                  href: `/dashboard/stores/meals/${v.id}`,
                  cells: {
                    date: { node: isoDay(v.date), sort: v.date.getTime() },
                    meal: { node: v.meal, sort: v.meal },
                    pct: {
                      node: `${v.permille > 0 ? "+" : ""}${(v.permille / 10).toFixed(1)}%`,
                      sort: v.permille,
                    },
                    status: { node: v.status === "open" ? "Open" : "Reviewed", sort: v.status },
                  },
                }))}
              />
            </section>
          </div>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-section font-bold">Per day</h2>
            <DataTable
              caption="Meal cost per day"
              empty="No meal issues in this period."
              columns={[
                { key: "date", label: "Date" },
                { key: "served", label: "Students", align: "right", width: "8rem" },
                { key: "cost", label: "Cost", align: "right", width: "9rem" },
                { key: "per", label: "Per student", align: "right", width: "9rem" },
              ]}
              mobile={{ title: "date", subtitle: ["cost"], value: "per" }}
              rows={[...meals.days].reverse().map((d) => ({
                id: d.date,
                cells: {
                  date: { node: d.date, sort: d.date },
                  served: { node: d.served, sort: d.served },
                  cost: { node: kesExact(d.costCents), sort: d.costCents },
                  per: { node: kesExact(d.perStudentCents), sort: d.perStudentCents },
                },
              }))}
            />
          </section>
        </>
      ) : null}

      {view === "stock" && onHand ? (
        <DataTable
          caption="Stock on hand"
          columns={[
            { key: "store", label: "Store", width: "10rem" },
            { key: "item", label: "Item" },
            { key: "qty", label: "On hand", align: "right", width: "9rem" },
            { key: "value", label: "Value", align: "right", width: "9rem" },
          ]}
          mobile={{ title: "item", subtitle: ["store", "value"], value: "qty" }}
          rows={onHand.map((i) => ({
            id: i.id,
            href: `/dashboard/stores/items/${i.id}`,
            cells: {
              store: { node: i.store, sort: i.store },
              item: { node: i.name, sort: i.name },
              qty: {
                node: (
                  <span
                    className={
                      i.reorderLevelMilli && i.onHandMilli <= i.reorderLevelMilli
                        ? "font-semibold text-status-overdue"
                        : ""
                    }
                  >
                    {formatQty(i.onHandMilli, i.unit)}
                  </span>
                ),
                sort: i.onHandMilli,
              },
              value: { node: kesExact(i.valueCents), sort: i.valueCents },
            },
          }))}
          footer={{
            store: "Total",
            item: "",
            qty: "",
            value: kesExact(onHand.reduce((n, i) => n + i.valueCents, 0)),
          }}
        />
      ) : null}

      {view === "movements" && ledger ? (
        <DataTable
          caption="Movements"
          empty="No movements in this period."
          columns={[
            { key: "date", label: "Date", width: "7rem" },
            { key: "item", label: "Item" },
            { key: "kind", label: "Type", width: "9rem" },
            { key: "detail", label: "Detail" },
            { key: "qty", label: "Quantity", align: "right", width: "8rem" },
            { key: "value", label: "Value", align: "right", width: "8rem" },
          ]}
          mobile={{ title: "item", subtitle: ["kind", "date"], value: "qty" }}
          rows={[...ledger.movements].reverse().map((m) => ({
            id: m.id,
            cells: {
              date: { node: isoDay(m.date), sort: m.date.getTime() },
              item: { node: m.item, sort: m.item },
              kind: { node: movementLabel(m.kind), sort: m.kind },
              detail: {
                node:
                  [m.supplier, m.deliveryNote ? `DN ${m.deliveryNote}` : null, m.detail]
                    .filter(Boolean)
                    .join(" · ") || "—",
              },
              qty: { node: formatQty(m.quantityMilli, m.unit), sort: m.quantityMilli },
              value: { node: kesExact(m.valueCents), sort: m.valueCents },
            },
          }))}
        />
      ) : null}

      {view === "consumption" && ledger ? (
        <DataTable
          caption="Consumption per item"
          empty="Nothing used in this period."
          columns={[
            { key: "item", label: "Item" },
            { key: "qty", label: "Used", align: "right", width: "10rem" },
            { key: "value", label: "Value", align: "right", width: "10rem" },
          ]}
          mobile={{ title: "item", subtitle: ["qty"], value: "value" }}
          rows={ledger.consumption.map((c) => ({
            id: c.itemId,
            cells: {
              item: { node: c.item, sort: c.item },
              qty: { node: formatQty(c.quantityMilli, c.unit), sort: c.quantityMilli },
              value: { node: kesExact(c.valueCents), sort: c.valueCents },
            },
          }))}
        />
      ) : null}

      {view === "uniforms" && ledger ? (
        <DataTable
          caption="Uniform issues and charges"
          empty="No uniform issues in this period."
          columns={[
            { key: "date", label: "Date", width: "7rem" },
            { key: "student", label: "Student" },
            { key: "item", label: "Item", width: "11rem" },
            { key: "amount", label: "Amount", align: "right", width: "8rem" },
            { key: "payment", label: "Payment", width: "10rem" },
          ]}
          mobile={{ title: "student", subtitle: ["item", "payment"], value: "amount" }}
          rows={ledger.uniforms.map((u) => ({
            id: u.id,
            cells: {
              date: { node: isoDay(u.date), sort: u.date.getTime() },
              student: { node: u.student, sort: u.student },
              item: { node: `${u.item}${u.quantity > 1 ? ` × ${u.quantity}` : ""}`, sort: u.item },
              amount: {
                node: (
                  <span className={u.status === "returned" ? "text-ink/40 line-through" : ""}>
                    {kesExact(u.totalCents)}
                  </span>
                ),
                sort: u.totalCents,
              },
              payment: {
                node:
                  u.status === "returned"
                    ? "Returned"
                    : u.payment === "charged"
                      ? "Charged to fees"
                      : `Paid (${u.reference})`,
                sort: u.payment,
              },
            },
          }))}
        />
      ) : null}

      {view === "stocktakes" && ledger ? (
        ledger.stocktakes.length === 0 ? (
          <p className="text-ink/60">No stock-takes yet.</p>
        ) : (
          ledger.stocktakes.map((s) => (
            <section key={s.id} className="flex flex-col gap-2">
              <h2 className="font-heading text-section font-bold">
                {s.store} · {s.submittedAt ? isoDay(s.submittedAt) : ""} · {s.status}
              </h2>
              <DataTable
                caption={`Stock-take ${s.store}`}
                empty="No differences."
                columns={[
                  { key: "item", label: "Item" },
                  { key: "expected", label: "Records", align: "right", width: "9rem" },
                  { key: "counted", label: "Counted", align: "right", width: "9rem" },
                  { key: "value", label: "Value", align: "right", width: "9rem" },
                ]}
                mobile={{ title: "item", subtitle: ["expected", "counted"], value: "value" }}
                rows={s.lines.map((l, i) => ({
                  id: `${s.id}-${i}`,
                  cells: {
                    item: { node: l.item, sort: l.item },
                    expected: { node: formatQty(l.expectedMilli, l.unit), sort: l.expectedMilli },
                    counted: { node: formatQty(l.countedMilli, l.unit), sort: l.countedMilli },
                    value: { node: kesExact(l.valueCents), sort: l.valueCents },
                  },
                }))}
              />
            </section>
          ))
        )
      ) : null}
    </div>
  );
}
