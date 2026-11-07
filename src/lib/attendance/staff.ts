/**
 * Staff attendance. Everyone taps "I'm in" and "I'm leaving" on their own phone (only for
 * themselves: the database refuses anything else). The Principal, or someone they delegate
 * (staff_attendance.manage), can mark anyone and sees the daily and monthly reports.
 * No location is recorded.
 */
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { settingsIn } from "@/lib/settings/service";
import { isSchoolDay, isoDay, nairobiDate } from "./rules";

export const canManageStaffAttendance = (p: Actor["permissions"]) =>
  p.has("staff_attendance.manage");

const HIDDEN_ROLES = ["system_payments", "system_messaging"];

async function myMembership(tx: Tx, actor: Actor) {
  const m = await tx.membership.findFirst({
    where: { schoolId: actor.schoolId, userId: actor.userId, status: "active" },
    select: { id: true, displayName: true },
  });
  if (!m) throw new ForbiddenError("school.view");
  return m;
}

/** My day: when I tapped in and out. */
export async function myStaffDay({ db }: Deps, actor: Actor, now = new Date()) {
  return withContext(db, ctxOf(actor), async (tx) => {
    const m = await myMembership(tx, actor);
    return tx.staffAttendance.findUnique({
      where: {
        schoolId_membershipId_date: {
          schoolId: actor.schoolId,
          membershipId: m.id,
          date: nairobiDate(now),
        },
      },
    });
  });
}

/** "I'm in" (once a day) or "I'm leaving" (may be pressed again: the last time counts). */
export async function tapStaffAttendance(
  { db }: Deps,
  actor: Actor,
  kind: "in" | "out",
  now = new Date(),
) {
  return withContext(db, ctxOf(actor), async (tx) => {
    const m = await myMembership(tx, actor);
    const date = nairobiDate(now);
    const key = { schoolId: actor.schoolId, membershipId: m.id, date };
    const row = await tx.staffAttendance.findUnique({ where: { schoolId_membershipId_date: key } });
    if (kind === "out" && !row?.inAt) throw new ValidationError('Tap "I\'m in" first.');
    const saved = row
      ? await tx.staffAttendance.update({
          where: { schoolId: actor.schoolId, id: row.id },
          data:
            kind === "in"
              ? {
                  inAt: row.inAt ?? now,
                  status: "present",
                  source: "self",
                  markedById: actor.userId,
                }
              : { outAt: now, source: "self", markedById: actor.userId },
        })
      : await tx.staffAttendance.create({
          data: { ...key, status: "present", inAt: now, source: "self", markedById: actor.userId },
        });
    return saved;
  });
}

const STATUSES = ["present", "absent", "leave"] as const;
export type StaffStatus = (typeof STATUSES)[number];

/** The Principal (or a delegate) marks a staff member for a day. */
export async function markStaff(
  { db }: Deps,
  actor: Actor,
  input: { membershipId: string; date?: Date; status: string; note?: unknown },
  now = new Date(),
) {
  if (!canManageStaffAttendance(actor.permissions))
    throw new ForbiddenError("staff_attendance.manage");
  if (!(STATUSES as readonly string[]).includes(input.status))
    throw new ValidationError("Choose present, absent or on leave.");
  const date = input.date ?? nairobiDate(now);
  if (date > nairobiDate(now)) throw new ValidationError("That day hasn't come yet.");
  const note = clean(input.note)?.slice(0, 200) ?? null;
  return withContext(db, ctxOf(actor), async (tx) => {
    const m = await tx.membership.findFirst({
      where: { schoolId: actor.schoolId, id: input.membershipId, status: "active" },
      select: { id: true, displayName: true },
    });
    if (!m) throw new ValidationError("Staff member not found.");
    const key = { schoolId: actor.schoolId, membershipId: m.id, date };
    const before = await tx.staffAttendance.findUnique({
      where: { schoolId_membershipId_date: key },
    });
    const status = input.status as StaffStatus;
    const data = {
      status,
      source: "manual",
      markedById: actor.userId,
      note,
      inAt: status === "present" ? (before?.inAt ?? now) : null,
      outAt: status === "present" ? (before?.outAt ?? null) : null,
    };
    const row = before
      ? await tx.staffAttendance.update({
          where: { schoolId: actor.schoolId, id: before.id },
          data,
        })
      : await tx.staffAttendance.create({ data: { ...key, ...data } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "staff_attendance.mark",
      targetType: "membership",
      targetId: m.id,
      before: before ? { status: before.status, date: isoDay(date) } : undefined,
      after: { status, date: isoDay(date), note },
      ip: actor.ip,
    });
    return row;
  });
}

async function staffList(tx: Tx, schoolId: string) {
  return tx.membership.findMany({
    where: {
      schoolId,
      status: "active",
      roles: { none: { role: { key: { in: HIDDEN_ROLES } } } },
    },
    select: {
      id: true,
      displayName: true,
      roles: { select: { role: { select: { name: true } } } },
    },
    orderBy: { displayName: "asc" },
  });
}

/** Everyone's day (the Principal's daily report). */
export async function staffDaily({ db }: Deps, actor: Actor, day?: Date | null, now = new Date()) {
  if (!canManageStaffAttendance(actor.permissions))
    throw new ForbiddenError("staff_attendance.manage");
  const date = day ?? nairobiDate(now);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [staff, rows] = await Promise.all([
      staffList(tx, actor.schoolId),
      tx.staffAttendance.findMany({ where: { schoolId: actor.schoolId, date } }),
    ]);
    return {
      date,
      staff: staff.map((s) => {
        const r = rows.find((x) => x.membershipId === s.id);
        return {
          membershipId: s.id,
          name: s.displayName,
          roles: s.roles.map((x) => x.role.name).join(", "),
          status: (r?.status ?? null) as StaffStatus | null,
          inAt: r?.inAt ?? null,
          outAt: r?.outAt ?? null,
          source: r?.source ?? null,
          note: r?.note ?? null,
        };
      }),
    };
  });
}

/** A month: days present, absent and on leave per person, against the school days so far. */
export async function staffMonthly(
  { db }: Deps,
  actor: Actor,
  month: string | null,
  now = new Date(),
) {
  if (!canManageStaffAttendance(actor.permissions))
    throw new ForbiddenError("staff_attendance.manage");
  const today = nairobiDate(now);
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "") ?? [
    "",
    String(today.getUTCFullYear()),
    String(today.getUTCMonth() + 1).padStart(2, "0"),
  ];
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  const to = end < today ? end : today;
  return withContext(db, ctxOf(actor), async (tx) => {
    // School days so far this month, from the school week.
    const week = await settingsIn(tx, actor.schoolId);
    const schoolDays: string[] = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000))
      if (isSchoolDay(d, week)) schoolDays.push(isoDay(d));
    const [staff, rows] = await Promise.all([
      staffList(tx, actor.schoolId),
      tx.staffAttendance.findMany({
        where: { schoolId: actor.schoolId, date: { gte: from, lte: to } },
        select: { membershipId: true, date: true, status: true, inAt: true },
      }),
    ]);
    return {
      month: `${m[1]}-${m[2]}`,
      schoolDays: schoolDays.length,
      staff: staff.map((s) => {
        const mine = rows.filter((r) => r.membershipId === s.id);
        const present = mine.filter((r) => r.status === "present").length;
        const leave = mine.filter((r) => r.status === "leave").length;
        const absent = mine.filter((r) => r.status === "absent").length;
        const inTimes = mine
          .filter((r) => r.inAt)
          .map((r) => (r.inAt!.getTime() + 3 * 3600_000) % 86_400_000);
        const avg = inTimes.length
          ? Math.round(inTimes.reduce((a, b) => a + b, 0) / inTimes.length / 60_000)
          : null;
        return {
          membershipId: s.id,
          name: s.displayName,
          present,
          leave,
          absent,
          notRecorded: Math.max(0, schoolDays.length - present - leave - absent),
          averageIn:
            avg === null
              ? null
              : `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
        };
      }),
    };
  });
}
