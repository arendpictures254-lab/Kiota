/** A student's attendance over a period, from their marks (pure: server and portal). */
import { type DayStatus, type MarkStatus, attendancePercent, dayStatus, isoDay } from "./rules";

export type StudentAttendance = {
  period: { label: string; from: Date; to: Date };
  percent: number | null;
  daysAbsent: number;
  partDays: number;
  lates: number;
  days: { date: string; status: DayStatus }[];
};

/** Summarise marks (date + status) into what a profile shows. */
export function summarise(
  marks: readonly { date: Date; status: string }[],
  period: StudentAttendance["period"],
): StudentAttendance {
  const byDay = new Map<string, MarkStatus[]>();
  for (const m of marks) {
    const k = isoDay(m.date);
    byDay.set(k, [...(byDay.get(k) ?? []), m.status as MarkStatus]);
  }
  const days = [...byDay.entries()]
    .map(([date, list]) => ({ date, status: dayStatus(list)! }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    period,
    percent: attendancePercent(marks.map((m) => m.status as MarkStatus)),
    daysAbsent: days.filter((d) => d.status === "absent").length,
    partDays: days.filter((d) => d.status === "part").length,
    lates: marks.filter((m) => m.status === "late").length,
    days,
  };
}
