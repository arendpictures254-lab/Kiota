import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { ctxOf } from "@/lib/service-kit";
import { isoDay, nairobiDate } from "@/lib/attendance/rules";
import { listSuppliers } from "@/lib/stores/service";
import { receiveAction } from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Receive stock · Kiota" };

export default function ReceivePage() {
  return (
    <StoresShell title="Receive stock" width="form">
      <Suspense fallback={<Loading />}>
        <Receive />
      </Suspense>
    </StoresShell>
  );
}

/** A delivery: the item, packs or quantity, cost, supplier and delivery note. */
async function Receive() {
  const { actor } = await loadStoresActor();
  if (!actor.permissions.has("stores.receive"))
    return <Notice tone="error">Receiving stock is for the storekeeper.</Notice>;
  const [suppliers, items] = await Promise.all([
    listSuppliers(deps, actor),
    withContext(deps.db, ctxOf(actor), (tx) =>
      tx.storeItem.findMany({
        where: { schoolId: actor.schoolId, active: true },
        include: { store: { select: { name: true, position: true } } },
        orderBy: [{ store: { position: "asc" } }, { name: "asc" }, { size: "asc" }],
      }),
    ),
  ]);
  const today = isoDay(nairobiDate(new Date()));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink/70">
        Packs (a 90 kg bag, a 20 litre jerrycan) are counted in the item&apos;s unit. Need a new
        supplier?{" "}
        <Link href="/dashboard/stores/setup#suppliers" className="font-semibold text-teal">
          Add one
        </Link>
        .
      </p>
      <ActionForm action={receiveAction} submitLabel="Record delivery">
        <Select
          label="Item"
          name="itemId"
          options={items.map((i) => ({
            value: i.id,
            label: `${i.store.name}: ${i.name}${i.size ? ` (${i.size})` : ""}${i.packName ? ` · ${i.packName}` : ` · ${i.unit}`}`,
          }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Number of packs"
            name="packs"
            inputMode="numeric"
            hint="For items with a pack size"
          />
          <Field
            label="Or quantity in units"
            name="quantity"
            inputMode="decimal"
            hint="kg, litres, pieces…"
          />
          <Field label="Cost (KES)" name="cost" inputMode="decimal" required />
          <Select
            label="The cost is"
            name="costPer"
            options={[
              { value: "total", label: "For the whole delivery" },
              { value: "pack", label: "Per pack" },
              { value: "unit", label: "Per unit" },
            ]}
          />
          <Select
            label="Supplier"
            name="supplierId"
            placeholder="(none)"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Field label="Delivery note no." name="deliveryNote" />
          <Field label="Date" name="date" type="date" defaultValue={today} />
          <Field label="Expiry date (perishables)" name="expiryDate" type="date" />
        </div>
      </ActionForm>
    </div>
  );
}
