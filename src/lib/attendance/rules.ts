/**
 * Attendance rules, pure (shared by the register screen in the browser and the server).
 *
 * A register is one stream, one session (e.g. Morning) and one day. Everyone starts Present;
 * a tap cycles Present → Absent → Late → Present. Students on an approved leave-out are On leave
 * and cannot be marked. A submitted register may be corrected the same day by whoever took it;
 * after that day only with attendance.manage (the Principal or Director).
 */

export type MarkStatus = "present" | "absent" | "late" | "on_leave";
export type TapStatus = Exclude<MarkStatus, "on_leave">;

/** The next status when the teacher taps a name. */
export function nextStatus(s: TapStatus): TapStatus {
  return s === "present" ? "absent" : s === "absent" ? "late" : "present";
}

const NAIROBI_OFFSET_MS = 3 * 3600_000;

/** The school day (Nairobi) as a UTC midnight Date, the form a @db.Date column takes. */
export function nairobiDate(now: Date): Date {
  const n = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** Minutes after midnight, Nairobi time. */
export function nairobiMinute(now: Date): number {
  const n = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  return n.getUTCHours() * 60 + n.getUTCMinutes();
}

/** The instant at `minute` past midnight (Nairobi) on a school day. */
export function atMinute(day: Date, minute: number): Date {
  return new Date(day.getTime() + minute * 60_000 - NAIROBI_OFFSET_MS);
}

/** "2026-11-06" for a @db.Date value. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** A YYYY-MM-DD string as a @db.Date value, or null. */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);

/** The school week (a school setting): weekdays for everyone, and Saturday for some levels. */
export type SchoolWeek = { schoolDays: number[]; saturdayLevelIds: string[] };

export const DEFAULT_WEEK: SchoolWeek = { schoolDays: [1, 2, 3, 4, 5], saturdayLevelIds: [] };

/**
 * Whether registers are expected on this day (0 = Sunday ... 6 = Saturday): a school day for
 * everyone, or a Saturday for a level that has Saturday classes. Without a level: whether
 * anyone has school that day (staff attendance, the school's own reports).
 */
export function isSchoolDay(day: Date, week: SchoolWeek = DEFAULT_WEEK, levelId?: string | null) {
  const dow = day.getUTCDay();
  if (week.schoolDays.includes(dow)) return true;
  if (dow !== 6 || week.saturdayLevelIds.length === 0) return false;
  return levelId === undefined || levelId === null ? true : week.saturdayLevelIds.includes(levelId);
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Who may change a register that was already submitted:
 *  - on the same day: whoever may take it (its class teacher, or attendance.manage);
 *  - on a later day: only attendance.manage.
 */
export function correctionAllowed(opts: {
  registerDay: Date;
  today: Date;
  canTake: boolean;
  canManage: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (opts.canManage) return { ok: true };
  if (!opts.canTake) return { ok: false, reason: "You can't take this register." };
  if (sameDay(opts.registerDay, opts.today)) return { ok: true };
  return {
    ok: false,
    reason: "This register is from an earlier day: ask the Principal to correct it.",
  };
}

/** A day's status from its registers: the worst one wins, and "part" if absent from some. */
export type DayStatus = "present" | "late" | "absent" | "part" | "on_leave";

export function dayStatus(marks: readonly MarkStatus[]): DayStatus | null {
  const taken = marks.filter((m) => m !== "on_leave");
  if (marks.length === 0) return null;
  if (taken.length === 0) return "on_leave";
  const absent = taken.filter((m) => m === "absent").length;
  if (absent === taken.length) return "absent";
  if (absent > 0) return "part";
  return taken.includes("late") ? "late" : "present";
}

/** Attendance %: registers present or late, of those taken (on leave doesn't count). */
export function attendancePercent(marks: readonly MarkStatus[]): number | null {
  const taken = marks.filter((m) => m !== "on_leave");
  if (taken.length === 0) return null;
  const there = taken.filter((m) => m === "present" || m === "late").length;
  return Math.round((there / taken.length) * 1000) / 10;
}

export const STATUS_LABEL: Record<MarkStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  on_leave: "On leave",
};

export const DAY_LABEL: Record<DayStatus, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  part: "Absent from part of the day",
  on_leave: "On leave",
};
