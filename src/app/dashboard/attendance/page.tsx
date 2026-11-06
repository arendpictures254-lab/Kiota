import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { isoDay } from "@/lib/attendance/rules";
import {
  attendanceToday,
  canHandleBoarderAlerts,
  canManageAttendance,
  canTakeAttendance,
  myRegisters,
} from "@/lib/attendance/service";
import { canManageStaffAttendance } from "@/lib/attendance/staff";
import { AttendanceShell, dayLabel, hhmm, loadAttendanceActor, nairobiTime } from "./shared";
import { AttendanceGlance } from "./widgets";

export const metadata: Metadata = { title: "Attendance · Kiota" };

type Props = PageProps<"/dashboard/attendance">;

export default function AttendancePage({ searchParams }: Props) {
  return (
    <AttendanceShell title="Attendance" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Hub searchParams={searchParams} />
      </Suspense>
    </AttendanceShell>
  );
}

async function Hub({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAttendanceActor();
  const p = actor.permissions;
  const done = (await searchParams).done;
  const [registers, today] = await Promise.all([
    canTakeAttendance(p) ? myRegisters(deps, actor) : null,
    canManageAttendance(p) ? attendanceToday(deps, actor) : null,
  ]);
  const [absent, late, corrected] = typeof done === "string" ? done.split("-") : [];

  return (
    <div className="flex flex-col gap-6">
      {done ? (
        <Notice tone="success">
          {corrected === "1" ? "Corrections saved" : "Register submitted"}: {absent} absent, {late}{" "}
          late.
          {Number(absent) > 0
            ? " Parents of absent day scholars get an SMS after the school's delay; boarding staff check on absent boarders."
            : ""}
        </Notice>
      ) : null}

      {registers ? (
        <section className="flex flex-col gap-3" aria-labelledby="mine">
          <h2 id="mine" className="font-heading text-section font-bold">
            {canManageAttendance(p) ? "Registers today" : "Your registers today"} ·{" "}
            <span className="font-sans text-base font-normal text-ink/70">
              {dayLabel(registers.today)}
            </span>
          </h2>
          {registers.streams.length === 0 ? (
            <p className="text-ink/60">
              You are not class teacher of a stream. School setup → Classes sets class teachers.
            </p>
          ) : null}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0">
            {registers.streams.map((st) => (
              <li
                key={st.id}
                className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
              >
                <span className="font-semibold text-ink">{st.label}</span>
                <div className="flex flex-wrap gap-2">
                  {st.registers.map((r) => {
                    const s = registers.sessions.find((x) => x.id === r.sessionId)!;
                    const href = `/dashboard/attendance/register?stream=${st.id}&session=${s.id}&date=${isoDay(registers.today)}`;
                    return r.submittedAt ? (
                      <Link
                        key={s.id}
                        href={href}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-status-paid/10 px-3 text-sm font-semibold text-status-paid"
                      >
                        ✓ {s.name} · {nairobiTime(r.submittedAt)}
                      </Link>
                    ) : (
                      <Link
                        key={s.id}
                        href={href}
                        className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ${
                          r.overdue
                            ? "bg-status-overdue text-white"
                            : s.open
                              ? "bg-teal text-white"
                              : "border border-teal/30 bg-white text-teal"
                        }`}
                      >
                        Take {s.name.toLowerCase()} register
                        {r.overdue ? " (late)" : !s.open ? ` · from ${hhmm(s.opensMinute)}` : ""}
                      </Link>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {today ? <AttendanceGlance t={today} /> : null}

      <section className="flex flex-col gap-3" aria-labelledby="more">
        <h2 id="more" className="sr-only">
          More
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canHandleBoarderAlerts(p) || canManageAttendance(p) ? (
            <ButtonLink href="/dashboard/attendance/boarders" variant="secondary">
              Absent boarders{today?.waitingBoarders ? ` (${today.waitingBoarders})` : ""}
            </ButtonLink>
          ) : null}
          {canManageAttendance(p) ? (
            <ButtonLink href="/dashboard/attendance/reports" variant="secondary">
              Reports and export
            </ButtonLink>
          ) : null}
          {canManageStaffAttendance(p) ? (
            <ButtonLink href="/dashboard/attendance/staff" variant="secondary">
              Staff attendance
            </ButtonLink>
          ) : null}
          {canManageAttendance(p) ? (
            <ButtonLink href="/dashboard/attendance/settings" variant="secondary">
              Register times and alerts
            </ButtonLink>
          ) : null}
        </div>
      </section>
    </div>
  );
}
