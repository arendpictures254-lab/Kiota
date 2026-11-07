import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { DataTable } from "@/components/data-table";
import { Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay } from "@/lib/attendance/rules";
import { mealIssueDetail } from "@/lib/stores/meals";
import { formatQty, kesExact } from "@/lib/stores/stock";
import { confirmServedAction, reviewVarianceAction } from "../../actions";
import { StoresShell, loadStoresActor } from "../../shared";

export const metadata: Metadata = { title: "Meal issue · Kiota" };

type Props = PageProps<"/dashboard/stores/meals/[issueId]">;

export default function MealIssuePage({ params, searchParams }: Props) {
  return (
    <StoresShell width="reading" back={{ href: "/dashboard/stores/meals", label: "Meals" }}>
      <Suspense fallback={<Loading />}>
        <Issue params={params} searchParams={searchParams} />
      </Suspense>
    </StoresShell>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v / 10).toFixed(1)}%`);

async function Issue({ params, searchParams }: Props) {
  const { issueId } = await params;
  const isNew = !!(await searchParams).new;
  const { actor } = await loadStoresActor({ kitchen: true });
  if (!/^[0-9a-f-]{36}$/i.test(issueId)) notFound();
  const i = await mealIssueDetail(deps, actor, issueId);
  if (!i) notFound();
  const p = actor.permissions;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-title font-bold text-ink">
          {i.meal.name} · {isoDay(i.date)}
        </h1>
        <p className="text-ink/70">
          {i.studentsServed} students · {kesExact(i.costCents)} ·{" "}
          {kesExact(Math.round(i.costCents / Math.max(1, i.studentsServed)))} per student · issued
          by {i.issuedBy ?? "staff"}
        </p>
      </header>
      {isNew ? (
        <Notice tone={i.varianceStatus === "open" ? "error" : "success"}>
          {i.varianceStatus === "open"
            ? `Recorded. This issue is ${pct(i.variancePermille)} away from the ration scale, so it has been flagged to the Director.`
            : "Recorded, within the ration scale."}
        </Notice>
      ) : null}
      {i.varianceStatus === "open" && !isNew ? (
        <Notice tone="error">Flagged: {pct(i.variancePermille)} away from the ration scale.</Notice>
      ) : null}
      {i.varianceStatus === "reviewed" ? (
        <Notice>
          Reviewed by {i.reviewedBy ?? "the Director"}
          {i.reviewNote ? `: ${i.reviewNote}` : ""}.
        </Notice>
      ) : null}
      <DataTable
        caption="Items issued"
        columns={[
          { key: "item", label: "Item" },
          { key: "suggested", label: "Ration scale", align: "right", width: "9rem" },
          { key: "actual", label: "Issued", align: "right", width: "9rem" },
          { key: "variance", label: "Difference", align: "right", width: "8rem" },
          { key: "cost", label: "Cost", align: "right", width: "8rem" },
        ]}
        mobile={{ title: "item", subtitle: ["suggested", "variance"], value: "actual" }}
        rows={i.lines.map((l) => ({
          id: l.id,
          cells: {
            item: { node: l.item.name, sort: l.item.name },
            suggested: { node: formatQty(l.suggestedMilli, l.item.unit), sort: l.suggestedMilli },
            actual: { node: formatQty(l.actualMilli, l.item.unit), sort: l.actualMilli },
            variance: { node: pct(l.variancePermille), sort: l.variancePermille ?? 0 },
            cost: { node: kesExact(l.costCents), sort: l.costCents },
          },
        }))}
      />
      <section className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="font-heading text-section font-bold">Served</h2>
        <p className="text-ink/70">
          {i.servedConfirmed !== null
            ? `${i.servedConfirmed} confirmed by ${i.confirmedBy ?? "the kitchen"}.`
            : "Not confirmed by the kitchen yet."}
        </p>
        {p.has("kitchen.confirm") || p.has("stores.issue") ? (
          <ActionForm
            action={confirmServedAction}
            submitLabel="Confirm number served"
            variant="secondary"
          >
            <input type="hidden" name="issueId" value={i.id} />
            <Field
              label="Students actually served"
              name="served"
              inputMode="numeric"
              defaultValue={String(i.servedConfirmed ?? i.studentsServed)}
              required
            />
          </ActionForm>
        ) : null}
      </section>
      {i.varianceStatus === "open" && p.has("stores.stocktake.approve") ? (
        <ActionForm action={reviewVarianceAction} submitLabel="Mark as reviewed">
          <input type="hidden" name="issueId" value={i.id} />
          <Field label="Note (what happened)" name="note" placeholder="Visitors at lunch" />
        </ActionForm>
      ) : null}
    </div>
  );
}
