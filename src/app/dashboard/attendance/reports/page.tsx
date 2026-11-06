import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataTable } from "@/components/data-table";
import { Card, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay, parseDay } from "@/lib/attendance/rules";
import { attendanceReport, canManageAttendance } from "@/lib/attendance/service";
import { AttendanceShell, loadAttendanceActor } from "../shared";

export const metadata: Metadata = { title: "Attendance reports · Kiota" };

type Props = PageProps<"/dashboard/attendance/reports">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function ReportsPage({ searchParams }: Props) {
  return (
    <AttendanceShell title="Attendance reports">
      <Suspense fallback={<Loading />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </AttendanceShell>
  );
}

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

async function Reports({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAttendanceActor();
  if (!canManageAttendance(actor.permissions))
    return <Notice tone="error">For the Principal and Director.</Notice>;
  const sp = await searchParams;
  const r = await attendanceReport(deps, actor, {
    from: parseDay(one(sp.from)),
    to: parseDay(one(sp.to)),
  });
  const q = `from=${isoDay(r.period.from)}&to=${isoDay(r.period.to)}`;
  const maxLate = Math.max(1, ...r.latesByWeekday.map((d) => d.lates));
  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-wrap items-end gap-3" action="/dashboard/attendance/reports">
        {(["from", "to"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm font-semibold">
            {k === "from" ? "From" : "To"}
            <input
              type="date"
              name={k}
              defaultValue={isoDay(r.period[k])}
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
          href={`/dashboard/attendance/export?${q}`}
          className="inline-flex h-12 items-center rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal hover:bg-egg-blue/30"
        >
          Export to Excel
        </a>
      </form>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-ink/60">Whole school · {r.period.label}</p>
          <p className="font-heading text-display font-bold text-teal">{pct(r.school)}</p>
          <p className="text-sm text-ink/60">present or late, of registers taken</p>
        </Card>
        <Card className="flex flex-col gap-1">
          <p className="text-sm text-ink/60">Frequent absences</p>
          <p className="font-heading text-display font-bold text-status-overdue">
            {r.frequentAbsences.length}
          </p>
          <p className="text-sm text-ink/60">students absent 3 days or more</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-ink/60">Lates by day of the week</p>
          <ul className="flex items-end gap-2" aria-label="Lates by day of the week">
            {r.latesByWeekday.map((d) => (
              <li key={d.day} className="flex flex-1 flex-col items-center gap-1 text-xs">
                <span className="font-semibold">{d.lates}</span>
                <span
                  className="w-full rounded-t bg-status-due"
                  style={{ height: `${Math.max(4, (d.lates / maxLate) * 56)}px` }}
                  aria-hidden
                />
                <span className="text-ink/60">{d.day}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-section font-bold">By stream</h2>
        <DataTable
          caption="Attendance by stream"
          empty="No registers in this period."
          columns={[
            { key: "stream", label: "Stream" },
            { key: "percent", label: "Attendance", align: "right", width: "9rem" },
            { key: "absent", label: "Absences", align: "right", width: "8rem" },
            { key: "late", label: "Lates", align: "right", width: "7rem" },
          ]}
          mobile={{ title: "stream", subtitle: ["absent", "late"], value: "percent" }}
          rows={r.streams.map((s) => ({
            id: s.id,
            cells: {
              stream: { node: s.label, sort: s.label },
              percent: { node: pct(s.percent), sort: s.percent ?? -1 },
              absent: { node: s.absent, sort: s.absent },
              late: { node: s.late, sort: s.late },
            },
          }))}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {(
          [
            ["Frequent absences", r.frequentAbsences, "absent"],
            ["Often late", r.frequentLates, "late"],
          ] as const
        ).map(([title, rows, kind]) => (
          <section key={title} className="flex min-w-0 flex-col gap-2">
            <h2 className="font-heading text-section font-bold">{title}</h2>
            <DataTable
              caption={title}
              empty="Nobody."
              columns={[
                { key: "name", label: "Student" },
                { key: "class", label: "Class", width: "9rem" },
                {
                  key: "count",
                  label: kind === "absent" ? "Days absent" : "Lates",
                  align: "right",
                  width: "8rem",
                },
                { key: "percent", label: "Attendance", align: "right", width: "8rem" },
              ]}
              mobile={{ title: "name", subtitle: ["class", "percent"], value: "count" }}
              rows={rows.map((s) => ({
                id: s.id,
                href: `/dashboard/students/${s.id}`,
                cells: {
                  name: { node: s.name, sort: s.name },
                  class: { node: s.className, sort: s.className },
                  count: {
                    node:
                      kind === "absent"
                        ? `${s.daysAbsent}${s.partDays ? ` + ${s.partDays} part` : ""}`
                        : s.lates,
                    sort: kind === "absent" ? s.daysAbsent + s.partDays : s.lates,
                  },
                  percent: { node: pct(s.percent), sort: s.percent ?? -1 },
                },
              }))}
            />
          </section>
        ))}
      </div>
      <p className="text-xs text-ink/60">
        Attendance counts registers marked present or late; students on leave are left out.{" "}
        <Link href="/dashboard/attendance" className="font-semibold text-teal">
          Back to today
        </Link>
      </p>
    </div>
  );
}
