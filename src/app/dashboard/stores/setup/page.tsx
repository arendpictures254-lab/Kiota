import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { ctxOf } from "@/lib/service-kit";
import { listMeals } from "@/lib/stores/meals";
import { STORE_KINDS, listStores, listSuppliers, storesSettings } from "@/lib/stores/service";
import { formatQty } from "@/lib/stores/stock";
import {
  mealAction,
  rationAction,
  storeAction,
  storesSettingsAction,
  supplierAction,
} from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Stores setup · Kiota" };

export default function StoresSetupPage() {
  return (
    <StoresShell title="Stores setup">
      <Suspense fallback={<Loading />}>
        <Setup />
      </Suspense>
    </StoresShell>
  );
}

async function Setup() {
  const { actor } = await loadStoresActor();
  if (!actor.permissions.has("stores.setup"))
    return <Notice tone="error">Stores setup is for the storekeeper and Director.</Notice>;
  const [stores, suppliers, meals, settings, foodItems] = await Promise.all([
    listStores(deps, actor),
    listSuppliers(deps, actor),
    listMeals(deps, actor),
    storesSettings(deps, actor),
    withContext(deps.db, ctxOf(actor), (tx) =>
      tx.storeItem.findMany({
        where: { schoolId: actor.schoolId, active: true, store: { kind: "food" } },
        orderBy: { name: "asc" },
      }),
    ),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <section id="meals" className="flex scroll-mt-20 flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Meals and ration scales</h2>
        <p className="max-w-[72ch] text-sm text-ink/70">
          How much of each item one student gets at each meal. Kiota multiplies by the students
          served to suggest what to issue, and flags issues more than {settings.mealVariancePercent}
          % away.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          {meals.map((m) => (
            <Card key={m.id} className="flex min-w-0 flex-col gap-3">
              <ActionForm
                action={mealAction}
                submitLabel="Save"
                variant="secondary"
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
              >
                <input type="hidden" name="id" value={m.id} />
                <Field
                  label="Meal"
                  name="name"
                  id={`meal-${m.id}`}
                  defaultValue={m.name}
                  required
                />
              </ActionForm>
              <ul className="flex flex-col divide-y divide-ink/5 text-sm">
                {m.rations.map((r) => {
                  const item = foodItems.find((i) => i.id === r.itemId);
                  return item ? (
                    <li key={r.id} className="flex justify-between gap-2 py-1.5">
                      <span>{item.name}</span>
                      <span className="font-semibold">
                        {formatQty(r.perStudentMilli, item.unit)} per student
                      </span>
                    </li>
                  ) : null;
                })}
                {m.rations.length === 0 ? (
                  <li className="py-1.5 text-ink/60">No ration scale yet.</li>
                ) : null}
              </ul>
              <ActionForm
                action={rationAction}
                submitLabel="Set"
                variant="secondary"
                className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
              >
                <input type="hidden" name="mealId" value={m.id} />
                <Select
                  label="Item"
                  name="itemId"
                  id={`ri-${m.id}`}
                  options={foodItems.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
                />
                <Field
                  label="Per student"
                  name="perStudent"
                  id={`rp-${m.id}`}
                  inputMode="decimal"
                  hint="0.15 = 150 g; 0 removes"
                  required
                />
              </ActionForm>
            </Card>
          ))}
        </div>
        <ActionForm
          action={mealAction}
          submitLabel="Add meal"
          variant="secondary"
          className="grid max-w-xl grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
        >
          <Field label="New meal" name="name" id="meal-new" placeholder="10 o'clock tea" required />
        </ActionForm>
      </section>

      <section id="suppliers" className="flex scroll-mt-20 flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Suppliers</h2>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {suppliers.map((s) => (
            <li key={s.id} className="rounded-2xl border border-ink/10 bg-white p-4 text-sm">
              <span className="block font-semibold text-ink">{s.name}</span>
              <span className="text-ink/60">
                {[s.phone, s.kraPin ? `KRA ${s.kraPin}` : null].filter(Boolean).join(" · ") ||
                  "No details"}
              </span>
            </li>
          ))}
        </ul>
        <ActionForm
          action={supplierAction}
          submitLabel="Add supplier"
          variant="secondary"
          className="flex max-w-[720px] flex-col gap-3"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" name="name" id="sup-name" required />
            <Field label="Phone" name="phone" id="sup-phone" inputMode="tel" />
            <Field label="KRA PIN (optional)" name="kraPin" id="sup-kra" />
          </div>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Stores</h2>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
          {stores.map((s) => (
            <li key={s.id}>
              <ActionForm
                action={storeAction}
                submitLabel="Save"
                variant="secondary"
                className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
              >
                <input type="hidden" name="id" value={s.id} />
                <Field label="Name" name="name" id={`st-${s.id}`} defaultValue={s.name} required />
                <Select
                  label="Kind"
                  name="kind"
                  id={`sk-${s.id}`}
                  defaultValue={s.kind}
                  options={[...STORE_KINDS]}
                />
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm
          action={storeAction}
          submitLabel="Add store"
          variant="secondary"
          className="grid max-w-[720px] grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <Field label="New store" name="name" id="st-new" placeholder="Science store" required />
          <Select
            label="Kind"
            name="kind"
            id="sk-new"
            defaultValue="general"
            options={[...STORE_KINDS]}
          />
        </ActionForm>
      </section>

      <section className="flex max-w-[720px] flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Settings</h2>
        <ActionForm action={storesSettingsAction} submitLabel="Save">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Flag meal issues more than (%) away"
              name="mealVariancePercent"
              inputMode="numeric"
              defaultValue={String(settings.mealVariancePercent)}
              required
            />
            <Select
              label="Uniforms are charged to"
              name="uniformVoteHeadId"
              defaultValue={settings.uniformVoteHeadId ?? ""}
              placeholder="(choose a vote head)"
              options={settings.voteHeads.map((v) => ({ value: v.id, label: v.name }))}
            />
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
