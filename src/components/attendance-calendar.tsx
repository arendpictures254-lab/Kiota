import type { DayStatus } from "@/lib/attendance/rules";

const TONE: Record<DayStatus, string> = {
  present: "bg-status-paid text-white",
  late: "bg-status-due text-ink",
  absent: "bg-status-overdue text-white",
  part: "bg-white text-status-overdue ring-2 ring-inset ring-status-overdue",
  on_leave: "bg-egg-blue text-ink",
};

export type CalendarLabels = Record<DayStatus | "none", string> & { weekdays: string[] };

export const EN_CALENDAR: CalendarLabels = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  part: "Absent for part of the day",
  on_leave: "On leave",
  none: "No register",
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
};

/**
 * A simple school-week calendar (Monday to Friday) of a student's days: one square per day,
 * coloured by the day's status, with a legend. Weekends are left out.
 */
export function AttendanceCalendar({
  days,
  from,
  to,
  labels = EN_CALENDAR,
}: {
  days: { date: string; status: DayStatus }[];
  from: Date;
  to: Date;
  labels?: CalendarLabels;
}) {
  const byDate = new Map(days.map((d) => [d.date, d.status]));
  // Start on the Monday of the first week.
  const start = new Date(from.getTime() - ((from.getUTCDay() + 6) % 7) * 86_400_000);
  const weeks: { date: Date; inRange: boolean }[][] = [];
  for (let w = new Date(start); w <= to; w = new Date(w.getTime() + 7 * 86_400_000)) {
    const week = [0, 1, 2, 3, 4].map((i) => {
      const date = new Date(w.getTime() + i * 86_400_000);
      return { date, inRange: date >= from && date <= to };
    });
    // A week whose school days all fall outside the period (it starts at a weekend): left out.
    if (week.some((d) => d.inRange)) weeks.push(week);
  }
  const used = new Set(days.map((d) => d.status));
  return (
    <div className="flex flex-col gap-3" data-testid="attendance-calendar">
      <div className="grid grid-cols-5 gap-1.5 text-center text-xs text-ink/60" aria-hidden>
        {labels.weekdays.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ol className="flex flex-col gap-1.5">
        {weeks.map((week) => (
          <li key={week[0].date.toISOString()} className="grid grid-cols-5 gap-1.5">
            {week.map(({ date, inRange }) => {
              const key = date.toISOString().slice(0, 10);
              const s = byDate.get(key);
              const label = `${date.toLocaleDateString("en-KE", { timeZone: "UTC", day: "numeric", month: "short" })}: ${s ? labels[s] : labels.none}`;
              return (
                <span
                  key={key}
                  title={label}
                  aria-label={inRange ? label : undefined}
                  aria-hidden={inRange ? undefined : true}
                  className={`flex aspect-square max-h-12 items-center justify-center rounded-lg text-xs font-semibold ${
                    !inRange ? "opacity-0" : s ? TONE[s] : "bg-ink/5 text-ink/40"
                  }`}
                >
                  {date.getUTCDate()}
                </span>
              );
            })}
          </li>
        ))}
      </ol>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
        {(["present", "late", "absent", "part", "on_leave"] as const)
          .filter((s) => used.has(s))
          .map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`size-3 rounded ${TONE[s]}`} aria-hidden />
              {labels[s]}
            </li>
          ))}
      </ul>
    </div>
  );
}
