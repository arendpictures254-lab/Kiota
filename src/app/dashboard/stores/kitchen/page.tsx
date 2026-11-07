import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { mealIssuesOn } from "@/lib/stores/meals";
import { formatQty } from "@/lib/stores/stock";
import { confirmServedAction } from "../actions";
import { StoresShell, loadStoresActor } from "../shared";

export const metadata: Metadata = { title: "Kitchen · Kiota" };

export default function KitchenPage() {
  return (
    <StoresShell title="Kitchen today" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Kitchen />
      </Suspense>
    </StoresShell>
  );
}

/** The cook's screen: what the store issued for each meal today, and how many were served. */
async function Kitchen() {
  const { actor } = await loadStoresActor({ kitchen: true });
  const today = await mealIssuesOn(deps, actor);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink/70">{today.boardersPresent} boarders in school today.</p>
      {today.issues.length === 0 ? (
        <p className="text-ink/60">Nothing issued from the store yet today.</p>
      ) : null}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0">
        {today.issues.map((i) => (
          <li
            key={i.id}
            className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
            data-testid="kitchen-issue"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-heading text-section font-bold">{i.meal.name}</h2>
              <span className="text-sm text-ink/60">for {i.studentsServed}</span>
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {i.lines
                .filter((l) => l.actualMilli > 0)
                .map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>{l.item.name}</span>
                    <span className="font-semibold">{formatQty(l.actualMilli, l.item.unit)}</span>
                  </li>
                ))}
            </ul>
            {i.servedConfirmed !== null ? (
              <p className="text-sm font-semibold text-status-paid">✓ {i.servedConfirmed} served</p>
            ) : null}
            <ActionForm
              action={confirmServedAction}
              submitLabel={i.servedConfirmed !== null ? "Change" : "Confirm"}
              variant={i.servedConfirmed !== null ? "secondary" : "primary"}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
            >
              <input type="hidden" name="issueId" value={i.id} />
              <Field
                label="Students served"
                name="served"
                id={`served-${i.id}`}
                inputMode="numeric"
                defaultValue={String(i.servedConfirmed ?? i.studentsServed)}
                required
              />
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
