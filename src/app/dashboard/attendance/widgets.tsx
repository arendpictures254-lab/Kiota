import Link from "next/link";
import type { attendanceToday } from "@/lib/attendance/service";

type Today = Awaited<ReturnType<typeof attendanceToday>>;

/**
 * Today's attendance at a glance (Director and Principal dashboards, and the attendance page):
 * the current register's totals, each stream, and registers past their cut-off.
 */
export function AttendanceGlance({ t, compact = false }: { t: Today; compact?: boolean }) {
  const there = t.totals.present + t.totals.late;
  const marked = there + t.totals.absent;
  const pct = marked ? Math.round((there / marked) * 100) : null;
  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-ink/10 bg-white"
      aria-labelledby="att-today"
      data-testid="attendance-glance"
    >
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3 lg:px-5">
        <h2 id="att-today" className="font-heading text-section font-bold">
          Attendance today{t.session ? ` · ${t.session.name}` : ""}
        </h2>
        <Link
          href="/dashboard/attendance"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-teal"
        >
          Details →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4 lg:px-5">
        <Figure label="Present" value={pct === null ? "—" : `${pct}%`} tone="text-teal" />
        <Figure label="Absent" value={String(t.totals.absent)} tone="text-status-overdue" />
        <Figure label="Late" value={String(t.totals.late)} tone="text-status-due" />
        <Figure label="On leave" value={String(t.totals.onLeave)} />
      </div>
      <p className="px-4 pb-2 text-sm text-ink/60 lg:px-5">
        {t.taken} of {t.streamsTotal} registers taken
        {t.waitingBoarders ? (
          <>
            {" · "}
            <Link
              href="/dashboard/attendance/boarders"
              className="font-semibold text-status-overdue"
            >
              {t.waitingBoarders} absent boarder{t.waitingBoarders === 1 ? "" : "s"} to check
            </Link>
          </>
        ) : null}
      </p>
      {t.overdue.length ? (
        <div
          className="mx-4 mb-3 rounded-xl bg-status-due/15 p-3 lg:mx-5"
          data-testid="overdue-registers"
        >
          <p className="text-sm font-semibold text-ink">
            Not submitted after the cut-off ({t.overdue.length})
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink/80">
            {t.overdue.slice(0, compact ? 4 : 50).map((o) => (
              <li key={`${o.streamId}-${o.sessionId}`}>
                {o.stream} · {o.session}
                {o.teacher ? <span className="text-ink/60"> · {o.teacher}</span> : null}
              </li>
            ))}
            {compact && t.overdue.length > 4 ? (
              <li className="text-ink/60">and {t.overdue.length - 4} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      {!compact ? (
        <ul className="grid grid-cols-1 gap-x-6 border-t border-ink/10 px-4 py-2 sm:grid-cols-2 lg:px-5 xl:grid-cols-3">
          {t.streams.map((s) => (
            <li
              key={s.id}
              className="flex min-h-11 items-center justify-between gap-3 border-b border-ink/5 py-1 text-sm last:border-0"
            >
              <span className="font-semibold text-ink">{s.label}</span>
              <span className={s.taken ? "text-ink/70" : "text-status-due"}>
                {s.taken ? `${s.percent ?? 0}% · ${s.absent} absent` : "Not taken"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-ink/60">{label}</span>
      <span className={`font-heading text-[clamp(1.25rem,1rem+0.6vw,1.6rem)] font-bold ${tone}`}>
        {value}
      </span>
    </div>
  );
}
