import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { DataTable } from "@/components/data-table";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay, nairobiDate, parseDay } from "@/lib/attendance/rules";
import { canManageStaffAttendance, staffDaily, staffMonthly } from "@/lib/attendance/staff";
import { markStaffAction } from "../actions";
import { AttendanceShell, dayLabel, loadAttendanceActor, nairobiTime } from "../shared";

export const metadata: Metadata = { title: "Staff attendance · Kiota" };

type Props = PageProps<"/dashboard/attendance/staff">;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function StaffAttendancePage({ searchParams }: Props) {
  return (
    <AttendanceShell title="Staff attendance">
      <Suspense fallback={<Loading />}>
        <Staff searchParams={searchParams} />
      </Suspense>
    </AttendanceShell>
  );
}

const LABEL: Record<string, string> = { present: "In", absent: "Absent", leave: "On leave" };
const TONE: Record<string, string> = {
  present: "text-status-paid",
  absent: "text-status-overdue",
  leave: "text-ink/70",
};

/** Daily (with manual marking) and monthly staff attendance. No location is recorded. */
async function Staff({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAttendanceActor();
  if (!canManageStaffAttendance(actor.permissions))
    return <Notice tone="error">For the Principal, or someone they choose.</Notice>;
  const sp = await searchParams;
  const view = one(sp.view) === "month" ? "month" : "day";
  const day = parseDay(one(sp.date)) ?? nairobiDate(new Date());
  const tab = (key: string, label: string) => (
    <Link
      href={`?view=${key}`}
      aria-current={view === key ? "page" : undefined}
      className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${view === key ? "bg-teal text-white" : "bg-white text-teal"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-2 sm:max-w-sm" aria-label="Staff attendance">
        {tab("day", "Day")}
        {tab("month", "Month")}
      </nav>
      {view === "day" ? (
        <Daily actor={actor} day={day} />
      ) : (
        <Monthly actor={actor} month={one(sp.month) || null} />
      )}
    </div>
  );
}

type A = Awaited<ReturnType<typeof loadAttendanceActor>>["actor"];

async function Daily({ actor, day }: { actor: A; day: Date }) {
  const d = await staffDaily(deps, actor, day);
  const counts = {
    in: d.staff.filter((s) => s.status === "present").length,
    none: d.staff.filter((s) => !s.status).length,
  };
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="day" />
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Day
          <input
            type="date"
            name="date"
            defaultValue={isoDay(d.date)}
            className="h-12 rounded-xl border border-ink/20 bg-white px-3 font-normal"
          />
        </label>
        <button
          type="submit"
          className="h-12 rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal"
        >
          Show
        </button>
      </form>
      <p className="text-ink/70">
        {dayLabel(d.date)}: {counts.in} in, {counts.none} not recorded.
      </p>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0">
        {d.staff.map((s) => (
          <li
            key={s.membershipId}
            className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{s.name}</span>
                <span className="block text-sm text-ink/60">{s.roles}</span>
              </span>
              <span
                className={`shrink-0 text-sm font-semibold ${s.status ? TONE[s.status] : "text-ink/50"}`}
              >
                {s.status ? LABEL[s.status] : "Not recorded"}
              </span>
            </div>
            <p className="text-sm text-ink/70">
              {s.inAt ? `In ${nairobiTime(s.inAt)}` : ""}
              {s.outAt ? ` · Left ${nairobiTime(s.outAt)}` : ""}
              {s.source === "manual" ? " · marked by the office" : ""}
              {s.note ? ` · ${s.note}` : ""}
            </p>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-teal">Mark</summary>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["present", "absent", "leave"] as const).map((st) => (
                  <ActionForm
                    key={st}
                    action={markStaffAction}
                    submitLabel={LABEL[st]}
                    variant={st === "present" ? "primary" : "secondary"}
                    className="flex flex-col"
                  >
                    <input type="hidden" name="membershipId" value={s.membershipId} />
                    <input type="hidden" name="status" value={st} />
                    <input type="hidden" name="date" value={isoDay(d.date)} />
                  </ActionForm>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Monthly({ actor, month }: { actor: A; month: string | null }) {
  const m = await staffMonthly(deps, actor, month);
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="month" />
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Month
          <input
            type="month"
            name="month"
            defaultValue={m.month}
            className="h-12 rounded-xl border border-ink/20 bg-white px-3 font-normal"
          />
        </label>
        <button
          type="submit"
          className="h-12 rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal"
        >
          Show
        </button>
      </form>
      <p className="text-ink/70">{m.schoolDays} school days so far this month.</p>
      <DataTable
        caption="Staff attendance this month"
        columns={[
          { key: "name", label: "Staff member" },
          { key: "present", label: "Days in", align: "right", width: "7rem" },
          { key: "leave", label: "Leave", align: "right", width: "6rem" },
          { key: "absent", label: "Absent", align: "right", width: "6rem" },
          { key: "none", label: "Not recorded", align: "right", width: "8rem" },
          { key: "avg", label: "Usual time in", align: "right", width: "8rem" },
        ]}
        mobile={{ title: "name", subtitle: ["absent", "avg"], value: "present" }}
        rows={m.staff.map((s) => ({
          id: s.membershipId,
          cells: {
            name: { node: s.name, sort: s.name },
            present: { node: `${s.present} of ${m.schoolDays}`, sort: s.present },
            leave: { node: s.leave, sort: s.leave },
            absent: { node: s.absent, sort: s.absent },
            none: { node: s.notRecorded, sort: s.notRecorded },
            avg: { node: s.averageIn ?? "—", sort: s.averageIn ?? "" },
          },
        }))}
      />
    </div>
  );
}
