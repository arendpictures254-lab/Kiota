import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataTable } from "@/components/data-table";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { nairobiInput, whenText } from "@/lib/leaveout/rules";
import { canManageBoarding, leaveoutReports } from "@/lib/leaveout/service";
import { LeaveoutsShell, loadLeaveoutActor } from "../shared";

export const metadata: Metadata = { title: "Leave-out reports · Kiota" };

export default function ReportsPage({ searchParams }: PageProps<"/dashboard/leaveouts/reports">) {
  return (
    <LeaveoutsShell title="Leave-out reports">
      <Suspense fallback={<Loading />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </LeaveoutsShell>
  );
}

const day = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

async function Reports({
  searchParams,
}: Pick<PageProps<"/dashboard/leaveouts/reports">, "searchParams">) {
  const { actor } = await loadLeaveoutActor();
  if (!canManageBoarding(actor.permissions))
    return <Notice tone="error">Boarding staff only.</Notice>;
  const sp = await searchParams;
  const to = nairobiInput(`${sp.to ?? day(new Date())}T23:59`) ?? new Date();
  const from =
    nairobiInput(`${sp.from ?? day(new Date(new Date().getTime() - 90 * 86_400_000))}T00:00`) ??
    new Date(0);
  const r = await leaveoutReports(deps, actor, from, to);
  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-wrap items-end gap-2" action="/dashboard/leaveouts/reports">
        <label className="flex flex-col text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={day(from)}
            className="h-11 rounded-xl border border-ink/20 px-3"
          />
        </label>
        <label className="flex flex-col text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={day(to)}
            className="h-11 rounded-xl border border-ink/20 px-3"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-xl border border-teal/30 bg-white px-4 font-semibold text-teal"
        >
          Show
        </button>
      </form>
      <p className="text-ink/80">{r.total} leave-outs approved in this period.</p>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">Per class and reason</h2>
        <DataTable
          caption="Leave-outs per class and reason"
          empty="No leave-outs in this period."
          columns={[
            { key: "cls", label: "Class", width: "11rem" },
            ...r.reasons.map((x, i) => ({ key: `r${i}`, label: x, align: "right" as const })),
            { key: "total", label: "Total", align: "right", width: "6rem" },
          ]}
          mobile={{ title: "cls", subtitle: ["summary"], value: "total" }}
          rows={r.byClass.map((c) => ({
            id: c.cls,
            cells: {
              cls: { node: c.cls, sort: c.cls },
              total: { node: c.total, sort: c.total },
              summary: {
                node: c.counts
                  .map((n, i) => (n ? `${r.reasons[i]} ${n}` : ""))
                  .filter(Boolean)
                  .join(" · "),
              },
              ...Object.fromEntries(c.counts.map((n, i) => [`r${i}`, { node: n || "", sort: n }])),
            },
          }))}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">Late back ({r.late.length})</h2>
        {r.late.length === 0 ? <p className="text-ink/60">Nobody was late.</p> : null}
        <ul className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
          {r.late.map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leaveouts/${l.id}`}
                className="flex justify-between gap-2 rounded-2xl border border-ink/10 bg-white p-3"
              >
                <span>
                  <span className="font-semibold">{l.studentName}</span>
                  <span className="block text-sm text-ink/60">
                    Due {whenText(l.returnAt)} · {l.collectorName}
                  </span>
                </span>
                <span className="text-sm font-semibold text-status-overdue">
                  {l.returnedAt ? `${Math.round(l.lateMinutes / 6) / 10} h late` : "still out"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">By approver</h2>
        <ul className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
          {r.byApprover.map((a) => (
            <li key={a.name} className="flex justify-between rounded-xl bg-white px-3 py-2">
              <span>{a.name}</span>
              <span className="font-semibold">{a.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
