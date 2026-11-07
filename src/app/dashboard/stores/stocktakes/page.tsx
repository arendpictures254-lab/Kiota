import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { listStores } from "@/lib/stores/service";
import { kesExact } from "@/lib/stores/stock";
import { listStocktakes } from "@/lib/stores/stocktake";
import { startStocktakeAction } from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Stock-takes · Kiota" };

export default function StocktakesPage() {
  return (
    <StoresShell title="Stock-takes">
      <Suspense fallback={<Loading />}>
        <Stocktakes />
      </Suspense>
    </StoresShell>
  );
}

const STATUS: Record<string, { text: string; tone: string }> = {
  counting: { text: "Counting", tone: "bg-egg-blue/50 text-ink" },
  submitted: { text: "Waiting for approval", tone: "bg-status-due text-ink" },
  approved: { text: "Approved", tone: "bg-status-paid/15 text-status-paid" },
  rejected: { text: "Rejected", tone: "bg-ink/10 text-ink/60" },
};

async function Stocktakes() {
  const { actor } = await loadStoresActor();
  const p = actor.permissions;
  const [list, stores] = await Promise.all([listStocktakes(deps, actor), listStores(deps, actor)]);
  return (
    <div className="flex flex-col gap-5">
      {p.has("stores.adjust") || p.has("stores.issue") ? (
        <ActionForm
          action={startStocktakeAction}
          submitLabel="Start a stock-take"
          className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Select
              label="Store"
              name="storeId"
              options={stores.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        </ActionForm>
      ) : null}
      {list.length === 0 ? <p className="text-ink/60">No stock-takes yet.</p> : null}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
        {list.map((s) => (
          <li key={s.id}>
            <Link
              href={`/dashboard/stores/stocktakes/${s.id}`}
              className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{s.store}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS[s.status].tone}`}
                >
                  {STATUS[s.status].text}
                </span>
              </span>
              <span className="text-sm text-ink/60">
                Started {s.startedAt.toISOString().slice(0, 10)}
                {s.status !== "counting"
                  ? ` · ${s.differences} difference${s.differences === 1 ? "" : "s"} · ${kesExact(s.valueCents)}`
                  : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
