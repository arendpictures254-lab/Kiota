import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { DataTable } from "@/components/data-table";
import { Card, Field, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay, nairobiDate } from "@/lib/attendance/rules";
import { movementLabel } from "@/lib/stores/reports";
import { itemMovements, listStores } from "@/lib/stores/service";
import { UNITS, averageCostCents, formatQty, kesExact } from "@/lib/stores/stock";
import {
  adjustAction,
  issueAction,
  itemAction,
  receiveAction,
  transferAction,
} from "../../actions";
import { KIND_TONE, StoresShell, loadStoresActor } from "../../shared";

export const metadata: Metadata = { title: "Stock item · Kiota" };

type Props = PageProps<"/dashboard/stores/items/[itemId]">;

export default function ItemPage({ params }: Props) {
  return (
    <StoresShell>
      <Suspense fallback={<Loading />}>
        <Item params={params} />
      </Suspense>
    </StoresShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-ink/10 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-teal">{title}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

async function Item({ params }: Pick<Props, "params">) {
  const { itemId } = await params;
  const { actor } = await loadStoresActor();
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) notFound();
  const d = await itemMovements(deps, actor, itemId).catch(() => null);
  if (!d) notFound();
  const { item, position, movements, suppliers } = d;
  const p = actor.permissions;
  const stores = (await listStores(deps, actor)).filter((s) => s.id !== item.storeId && s.active);
  const avg = averageCostCents(position);
  const unitLabel = item.unit;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-semibold tracking-wide text-twig uppercase">{item.store.name}</p>
        <h1 className="font-heading text-title font-bold text-ink">
          {item.name}
          {item.size ? ` (${item.size})` : ""}
        </h1>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="flex flex-col p-4">
          <span className="text-xs text-ink/60">On hand</span>
          <span className="font-heading text-xl font-bold">
            {formatQty(position.quantityMilli, item.unit)}
          </span>
        </Card>
        <Card className="flex flex-col p-4">
          <span className="text-xs text-ink/60">Value</span>
          <span className="font-heading text-xl font-bold">{kesExact(position.valueCents)}</span>
        </Card>
        <Card className="flex flex-col p-4">
          <span className="text-xs text-ink/60">Average cost per {unitLabel}</span>
          <span className="font-heading text-xl font-bold">
            {avg === null ? "—" : kesExact(avg)}
          </span>
        </Card>
        <Card className="flex flex-col p-4">
          <span className="text-xs text-ink/60">
            {item.priceCents !== null ? "Price" : "Reorder at"}
          </span>
          <span className="font-heading text-xl font-bold">
            {item.priceCents !== null
              ? kesExact(item.priceCents)
              : item.reorderLevelMilli
                ? formatQty(item.reorderLevelMilli, item.unit)
                : "—"}
          </span>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {p.has("stores.receive") ? (
          <Panel title="Receive">
            <ActionForm action={receiveAction} submitLabel="Record delivery">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                {item.packSizeMilli ? (
                  <Field
                    label={`Number of ${item.packName ?? "packs"}`}
                    name="packs"
                    inputMode="numeric"
                    hint={`${formatQty(item.packSizeMilli, item.unit)} each. Or leave empty and enter the quantity.`}
                  />
                ) : null}
                <Field label={`Quantity (${unitLabel})`} name="quantity" inputMode="decimal" />
                <Field label="Cost (KES)" name="cost" inputMode="decimal" required />
                <Select
                  label="The cost is"
                  name="costPer"
                  options={[
                    { value: "total", label: "For the whole delivery" },
                    ...(item.packSizeMilli
                      ? [{ value: "pack", label: `Per ${item.packName ?? "pack"}` }]
                      : []),
                    { value: "unit", label: `Per ${unitLabel}` },
                  ]}
                />
                <Select
                  label="Supplier"
                  name="supplierId"
                  placeholder="(none)"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
                <Field label="Delivery note no." name="deliveryNote" />
                <Field
                  label="Date"
                  name="date"
                  type="date"
                  defaultValue={isoDay(nairobiDate(new Date()))}
                />
                {item.tracksExpiry ? (
                  <Field label="Expiry date" name="expiryDate" type="date" />
                ) : null}
              </div>
            </ActionForm>
          </Panel>
        ) : null}
        {p.has("stores.issue") ? (
          <Panel title="Issue">
            <ActionForm action={issueAction} submitLabel="Issue">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Quantity (${unitLabel})`}
                  name="quantity"
                  inputMode="decimal"
                  required
                />
                <Field label="Issued to" name="issuedTo" placeholder="Science lab" required />
              </div>
            </ActionForm>
          </Panel>
        ) : null}
        {p.has("stores.issue") && stores.length ? (
          <Panel title="Move to another store">
            <ActionForm action={transferAction} submitLabel="Move">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Quantity (${unitLabel})`}
                  name="quantity"
                  inputMode="decimal"
                  required
                />
                <Select
                  label="To"
                  name="toStoreId"
                  options={stores.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
            </ActionForm>
          </Panel>
        ) : null}
        {p.has("stores.adjust") ? (
          <Panel title="Adjust (with a reason)">
            <ActionForm action={adjustAction} submitLabel="Adjust" variant="danger">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Change (${unitLabel})`}
                  name="quantity"
                  inputMode="decimal"
                  hint="-2.5 for a loss, 1 for stock found"
                  required
                />
                <Field label="Reason" name="reason" placeholder="Bag torn, rice spoilt" required />
              </div>
            </ActionForm>
          </Panel>
        ) : null}
        {p.has("stores.setup") ? (
          <Panel title="Edit item">
            <ActionForm action={itemAction} submitLabel="Save">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="storeId" value={item.storeId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" name="name" defaultValue={item.name} required />
                <Field label="Size" name="size" defaultValue={item.size} />
                <Select
                  label="Unit"
                  name="unit"
                  defaultValue={item.unit}
                  options={UNITS.map((u) => ({ value: u.key, label: u.label }))}
                />
                <Field label="Shelf or category" name="category" defaultValue={item.category} />
                <Field
                  label="Reorder level"
                  name="reorderLevel"
                  defaultValue={String(item.reorderLevelMilli / 1000)}
                  inputMode="decimal"
                />
                <Field
                  label="Price (KES, uniforms)"
                  name="price"
                  defaultValue={item.priceCents !== null ? String(item.priceCents / 100) : ""}
                  inputMode="decimal"
                />
                <Field label="Pack name" name="packName" defaultValue={item.packName ?? ""} />
                <Field
                  label="Units in one pack"
                  name="packSize"
                  defaultValue={item.packSizeMilli ? String(item.packSizeMilli / 1000) : ""}
                  inputMode="decimal"
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm font-semibold">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="tracksExpiry"
                    defaultChecked={item.tracksExpiry}
                    className="size-5 accent-teal"
                  />
                  Records expiry dates
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={item.active}
                    className="size-5 accent-teal"
                  />
                  In use
                </label>
              </div>
            </ActionForm>
          </Panel>
        ) : null}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">Movements</h2>
        <DataTable
          caption="Stock movements"
          empty="No movements yet."
          columns={[
            { key: "date", label: "Date", width: "8rem" },
            { key: "kind", label: "Type", width: "10rem" },
            { key: "detail", label: "Detail" },
            { key: "qty", label: "Quantity", align: "right", width: "9rem" },
            { key: "value", label: "Value", align: "right", width: "9rem" },
          ]}
          mobile={{ title: "kind", subtitle: ["date", "detail"], value: "qty" }}
          rows={movements.map((m) => ({
            id: m.id,
            cells: {
              date: { node: isoDay(m.occurredOn), sort: m.occurredOn.getTime() },
              kind: {
                node: <span className={KIND_TONE[m.kind] ?? ""}>{movementLabel(m.kind)}</span>,
                sort: m.kind,
              },
              detail: {
                node:
                  [
                    suppliers.find((s) => s.id === m.supplierId)?.name,
                    m.deliveryNote ? `DN ${m.deliveryNote}` : null,
                    m.packs ? `${m.packs} × ${formatQty(m.packSizeMilli ?? 0, item.unit)}` : null,
                    m.expiryDate ? `expires ${isoDay(m.expiryDate)}` : null,
                    m.issuedTo,
                    m.reason,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—",
              },
              qty: { node: formatQty(m.quantityMilli, item.unit), sort: m.quantityMilli },
              value: { node: kesExact(m.valueCents), sort: m.valueCents },
            },
          }))}
        />
      </section>
    </div>
  );
}
