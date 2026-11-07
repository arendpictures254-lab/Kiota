import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay } from "@/lib/attendance/rules";
import { listMeals, mealIssuesOn, mealPlan } from "@/lib/stores/meals";
import { storesSettings } from "@/lib/stores/service";
import { kesExact } from "@/lib/stores/stock";
import { StoresShell, loadStoresActor } from "../shared";
import { MealForm } from "./meal-form";

export const metadata: Metadata = { title: "Issue for a meal · Kiota" };

type Props = PageProps<"/dashboard/stores/meals">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function MealsPage({ searchParams }: Props) {
  return (
    <StoresShell title="Issue for a meal">
      <Suspense fallback={<Loading />}>
        <Meals searchParams={searchParams} />
      </Suspense>
    </StoresShell>
  );
}

async function Meals({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadStoresActor();
  if (!actor.permissions.has("stores.issue"))
    return <Notice tone="error">Issuing for meals is for the storekeeper.</Notice>;
  const sp = await searchParams;
  const [meals, today, settings] = await Promise.all([
    listMeals(deps, actor),
    mealIssuesOn(deps, actor),
    storesSettings(deps, actor),
  ]);
  const active = meals.filter((m) => m.active);
  const done = new Set(today.issues.map((i) => i.mealId));
  const mealId = one(sp.meal) || active.find((m) => !done.has(m.id))?.id || active[0]?.id || "";
  const plan = mealId ? await mealPlan(deps, actor, mealId) : null;
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-2" aria-label="Meals">
        {active.map((m) => (
          <Link
            key={m.id}
            href={`?meal=${m.id}`}
            aria-current={m.id === mealId ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${m.id === mealId ? "bg-teal text-white" : "bg-white text-teal"}`}
          >
            {m.name}
            {done.has(m.id) ? <span aria-label="issued today">✓</span> : null}
          </Link>
        ))}
      </nav>
      {plan ? (
        plan.lines.length ? (
          <>
            <p className="text-ink/70">
              {plan.meal.name} · {isoDay(today.date)} · {plan.boardersPresent} boarders in school
              today
            </p>
            <MealForm
              key={plan.meal.id}
              mealId={plan.meal.id}
              date={isoDay(today.date)}
              served={plan.served}
              lines={plan.lines}
              thresholdPercent={settings.mealVariancePercent}
            />
          </>
        ) : (
          <Notice>
            {plan.meal.name} has no ration scale yet.{" "}
            <Link href="/dashboard/stores/setup#meals" className="font-semibold underline">
              Set it in Stores setup
            </Link>
            .
          </Notice>
        )
      ) : (
        <Notice>No meals set up.</Notice>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">Issued today</h2>
        {today.issues.length === 0 ? <p className="text-ink/60">Nothing yet.</p> : null}
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
          {today.issues.map((i) => (
            <li key={i.id}>
              <Link
                href={`/dashboard/stores/meals/${i.id}`}
                className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{i.meal.name}</span>
                  {i.varianceStatus === "open" ? (
                    <span className="rounded-full bg-status-due px-2 py-0.5 text-xs font-bold text-ink">
                      Variance
                    </span>
                  ) : null}
                </span>
                <span className="text-sm text-ink/60">
                  {i.studentsServed} students · {kesExact(i.costCents)} ·{" "}
                  {kesExact(Math.round(i.costCents / Math.max(1, i.studentsServed)))} each
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
