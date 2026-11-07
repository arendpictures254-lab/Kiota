import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { DataTable } from "@/components/data-table";
import { Field, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { storeStock } from "@/lib/stores/service";
import { UNITS, formatQty, kesExact } from "@/lib/stores/stock";
import { itemAction, startStocktakeAction } from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Store · Kiota" };

type Props = PageProps<"/dashboard/stores/[storeId]">;

export default function StorePage({ params }: Props) {
  return (
    <StoresShell>
      <Suspense fallback={<Loading />}>
        <Store params={params} />
      </Suspense>
    </StoresShell>
  );
}

async function Store({ params }: Pick<Props, "params">) {
  const { storeId } = await params;
  const { actor } = await loadStoresActor();
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) notFound();
  const s = await storeStock(deps, actor, storeId);
  if (!s) notFound();
  const p = actor.permissions;
  const uniform = s.store.kind === "uniform";
  const total = s.items.reduce((n, i) => n + i.valueCents, 0);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-title font-bold text-ink">{s.store.name}</h1>
        <p className="text-ink/70">
          {s.items.length} items · {kesExact(total)} at weighted average cost
        </p>
      </header>
      {p.has("stores.adjust") || p.has("stores.issue") ? (
        <ActionForm
          action={startStocktakeAction}
          submitLabel="Start a stock-take"
          variant="secondary"
          className="flex flex-col sm:w-60"
        >
          <input type="hidden" name="storeId" value={s.store.id} />
        </ActionForm>
      ) : null}
      <DataTable
        caption={`${s.store.name}: stock`}
        empty="No items yet."
        columns={[
          { key: "name", label: "Item" },
          { key: "category", label: uniform ? "Size" : "Shelf", width: "9rem" },
          { key: "onHand", label: "On hand", align: "right", width: "9rem" },
          { key: "value", label: "Value", align: "right", width: "9rem" },
          {
            key: "reorder",
            label: uniform ? "Price" : "Reorder at",
            align: "right",
            width: "9rem",
          },
        ]}
        mobile={{ title: "name", subtitle: ["value"], value: "onHand" }}
        rows={s.items.map((i) => ({
          id: i.id,
          href: `/dashboard/stores/items/${i.id}`,
          cells: {
            name: {
              node: `${i.name}${i.size ? ` (${i.size})` : ""}${i.active ? "" : " · hidden"}`,
              sort: `${i.name} ${i.size}`,
            },
            category: { node: uniform ? i.size : i.category, sort: uniform ? i.size : i.category },
            onHand: {
              node: (
                <span className={i.low ? "font-semibold text-status-overdue" : ""}>
                  {formatQty(i.onHandMilli, i.unit)}
                </span>
              ),
              sort: i.onHandMilli,
            },
            value: { node: kesExact(i.valueCents), sort: i.valueCents },
            reorder: {
              node: uniform
                ? i.priceCents !== null
                  ? kesExact(i.priceCents)
                  : "—"
                : i.reorderLevelMilli
                  ? formatQty(i.reorderLevelMilli, i.unit)
                  : "—",
              sort: uniform ? (i.priceCents ?? 0) : i.reorderLevelMilli,
            },
          },
        }))}
      />
      {p.has("stores.setup") ? (
        <details className="max-w-[720px] rounded-2xl border border-ink/10 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-teal">Add an item</summary>
          <ActionForm
            action={itemAction}
            submitLabel="Add item"
            className="mt-4 flex flex-col gap-4"
          >
            <input type="hidden" name="storeId" value={s.store.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Name"
                name="name"
                placeholder={uniform ? "Shirt" : "Maize flour"}
                required
              />
              {uniform ? (
                <Field label="Size" name="size" placeholder="12" />
              ) : (
                <Field label="Shelf or category" name="category" placeholder="Dry goods" />
              )}
              <Select
                label="Unit"
                name="unit"
                defaultValue={uniform ? "piece" : "kg"}
                options={UNITS.map((u) => ({ value: u.key, label: u.label }))}
              />
              {uniform ? (
                <Field label="Price (KES)" name="price" inputMode="decimal" required />
              ) : (
                <Field
                  label="Reorder level (in units)"
                  name="reorderLevel"
                  inputMode="decimal"
                  placeholder="50"
                />
              )}
              <Field label="Pack name (optional)" name="packName" placeholder="90 kg bag" />
              <Field
                label="Units in one pack"
                name="packSize"
                inputMode="decimal"
                placeholder="90"
              />
            </div>
            {!uniform ? (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="tracksExpiry" className="size-5 accent-teal" />
                Perishable: record expiry dates when received
              </label>
            ) : null}
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
