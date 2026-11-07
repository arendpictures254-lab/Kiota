/**
 * Class attendance: the register, corrections, absence alerts, and what the dashboards and the
 * student profile show. Permissions are checked here (not only in the UI), every query runs in
 * the school's row-level-security context, and every submit or correction is in the audit log.
 *
 *  - attendance.take: class teachers, for the streams they are class teacher of.
 *  - attendance.manage: the Principal and Director: every register, corrections on later days,
 *    register times, absence alert settings, reports.
 *  - boarding.alerts / boarding.manage: boarders marked absent ("found" or "not found").
 *
 * After a register, an absent day scholar's parents get an SMS once the school's delay has
 * passed (a quick correction cancels it). An absent boarder is on campus: the boarding staff are
 * told in the app first, and parents get an SMS only if the child is not found (critical), or
 * straight away if the school turned that on.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { notifyStaffWith } from "@/lib/leaveout/notify";
import {
  type Draft,
  type Recipient,
  guardianRecipients,
  planDrafts,
  queuePlanned,
} from "@/lib/messaging/outbox";
import { ensureMessagingMember, messagingActor } from "@/lib/messaging/system";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";
import { settingsIn } from "@/lib/settings/service";
import {
  type MarkStatus,
  atMinute,
  attendancePercent,
  correctionAllowed,
  isSchoolDay,
  isoDay,
  nairobiDate,
  nairobiMinute,
  sameDay,
} from "./rules";
import { type StudentAttendance, summarise } from "./summary";

export type { StudentAttendance };

type Perms = Actor["permissions"];
export const canManageAttendance = (p: Perms) => p.has("attendance.manage");
export const canTakeAttendance = (p: Perms) =>
  p.has("attendance.take") || p.has("attendance.manage");
export const canHandleBoarderAlerts = (p: Perms) =>
  p.has("boarding.alerts") || p.has("boarding.manage");

const firstName = (full: string) => full.split(" ")[0] ?? full;
const dateText = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

// ---------------------------------------------------------------------------
// Which registers a person takes
// ---------------------------------------------------------------------------

/** Streams this person may take the register for: all (attendance.manage) or their own. */
async function takeableStreams(tx: Tx, actor: Actor) {
  const manage = canManageAttendance(actor.permissions);
  if (!manage && !actor.permissions.has("attendance.take")) return [];
  return tx.stream.findMany({
    where: {
      schoolId: actor.schoolId,
      class: { level: { enabled: true } },
      ...(manage ? {} : { classTeacher: { userId: actor.userId, status: "active" } }),
    },
    select: { id: true, name: true, class: { select: { name: true, levelId: true } } },
    orderBy: [
      { class: { level: { sortOrder: "asc" } } },
      { class: { position: "asc" } },
      { name: "asc" },
    ],
  });
}

const streamLabel = (s: { name: string; class: { name: string } }) => `${s.class.name} ${s.name}`;

/** Today's registers for the person: one row per stream and session, taken or not. */
export async function myRegisters({ db }: Deps, actor: Actor, now = new Date()) {
  if (!canTakeAttendance(actor.permissions)) throw new ForbiddenError("attendance.take");
  const today = nairobiDate(now);
  const minute = nairobiMinute(now);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [streams, sessions] = await Promise.all([
      takeableStreams(tx, actor),
      tx.attendanceSession.findMany({
        where: { schoolId: actor.schoolId, active: true },
        orderBy: [{ position: "asc" }],
      }),
    ]);
    const registers = await tx.attendanceRegister.findMany({
      where: {
        schoolId: actor.schoolId,
        date: today,
        streamId: { in: streams.map((s) => s.id) },
      },
      select: { id: true, streamId: true, sessionId: true, submittedAt: true },
    });
    const week = await settingsIn(tx, actor.schoolId);
    return {
      today,
      sessions: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        opensMinute: s.opensMinute,
        cutoffMinute: s.cutoffMinute,
        open: minute >= s.opensMinute,
        late: minute > s.cutoffMinute,
      })),
      streams: streams.map((st) => ({
        id: st.id,
        label: streamLabel(st),
        registers: sessions.map((se) => {
          const r = registers.find((x) => x.streamId === st.id && x.sessionId === se.id);
          return {
            sessionId: se.id,
            submittedAt: r?.submittedAt ?? null,
            overdue: !r && isSchoolDay(today, week, st.class.levelId) && minute > se.cutoffMinute,
          };
        }),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// One register
// ---------------------------------------------------------------------------

type RegisterKey = { streamId: string; sessionId: string; date: Date };

async function registerContext(tx: Tx, actor: Actor, key: RegisterKey) {
  const stream = await tx.stream.findFirst({
    where: { schoolId: actor.schoolId, id: key.streamId },
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      classTeacher: { select: { userId: true, status: true } },
    },
  });
  if (!stream) throw new ValidationError("Stream not found.");
  const session = await tx.attendanceSession.findFirst({
    where: { schoolId: actor.schoolId, id: key.sessionId },
  });
  if (!session) throw new ValidationError("Register not found.");
  const manage = canManageAttendance(actor.permissions);
  const isTeacher =
    actor.permissions.has("attendance.take") &&
    stream.classTeacher?.userId === actor.userId &&
    stream.classTeacher.status === "active";
  if (!manage && !isTeacher) throw new ForbiddenError("attendance.take");
  return { stream, session, manage, canTake: isTeacher || manage };
}

/** Students on an approved leave-out during this register (they are "On leave"). */
async function onLeave(
  tx: Tx,
  schoolId: string,
  studentIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const rows = await tx.leaveout.findMany({
    where: {
      schoolId,
      studentId: { in: studentIds },
      OR: [
        { status: "out", exitedAt: { lte: to } },
        { status: "approved", leaveAt: { lte: to }, returnAt: { gte: from } },
      ],
    },
    select: { id: true, studentId: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.id]));
}

export type RegisterRow = {
  studentId: string;
  name: string;
  admissionNumber: string;
  boarder: boolean;
  hasPhoto: boolean;
  status: MarkStatus;
  /** On an approved leave-out: shown as On leave, can't be marked. */
  locked: boolean;
};

export async function loadRegister({ db }: Deps, actor: Actor, key: RegisterKey, now = new Date()) {
  if (!canTakeAttendance(actor.permissions)) throw new ForbiddenError("attendance.take");
  return withContext(db, ctxOf(actor), async (tx) => {
    const { stream, session, manage, canTake } = await registerContext(tx, actor, key);
    const students = await tx.student.findMany({
      where: { schoolId: actor.schoolId, streamId: stream.id, status: "active" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        boarder: true,
        photoKey: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    const register = await tx.attendanceRegister.findUnique({
      where: {
        schoolId_streamId_sessionId_date: {
          schoolId: actor.schoolId,
          streamId: stream.id,
          sessionId: session.id,
          date: key.date,
        },
      },
      select: { id: true, submittedAt: true, submittedById: true, correctedAt: true },
    });
    const marks = register
      ? await tx.attendanceMark.findMany({
          where: { schoolId: actor.schoolId, registerId: register.id },
          select: { studentId: true, status: true },
        })
      : [];
    const leave = await onLeave(
      tx,
      actor.schoolId,
      students.map((s) => s.id),
      atMinute(key.date, session.opensMinute),
      atMinute(key.date, session.cutoffMinute),
    );
    const submittedBy = register
      ? await tx.membership.findFirst({
          where: { schoolId: actor.schoolId, userId: register.submittedById },
          select: { displayName: true },
        })
      : null;
    const today = nairobiDate(now);
    const editable = register
      ? correctionAllowed({ registerDay: key.date, today, canTake, canManage: manage })
      : key.date > today
        ? { ok: false as const, reason: "This day hasn't come yet." }
        : sameDay(key.date, today) || manage
          ? { ok: true as const }
          : { ok: false as const, reason: "Only today's register can be taken." };
    return {
      stream: { id: stream.id, label: streamLabel(stream) },
      session: { id: session.id, name: session.name, cutoffMinute: session.cutoffMinute },
      date: key.date,
      submitted: register
        ? {
            at: register.submittedAt,
            by: submittedBy?.displayName ?? "Staff",
            correctedAt: register.correctedAt,
          }
        : null,
      editable,
      rows: students.map((s): RegisterRow => {
        const mark = marks.find((m) => m.studentId === s.id);
        const locked = leave.has(s.id);
        return {
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`,
          admissionNumber: s.admissionNumber,
          boarder: s.boarder,
          hasPhoto: !!s.photoKey,
          status: locked ? "on_leave" : ((mark?.status as MarkStatus | undefined) ?? "present"),
          locked,
        };
      }),
    };
  });
}

export type SubmitInput = RegisterKey & { absent: string[]; late: string[] };

/**
 * Submit (or correct) a register in one go: everyone not listed as absent or late is present;
 * students on leave are On leave whatever was sent.
 */
export async function submitRegister(
  deps: Deps,
  actor: Actor,
  input: SubmitInput,
  now = new Date(),
) {
  if (!canTakeAttendance(actor.permissions)) throw new ForbiddenError("attendance.take");
  const absent = new Set(input.absent);
  const late = new Set(input.late);
  const today = nairobiDate(now);
  if (input.date > today) throw new ValidationError("This day hasn't come yet.");
  const result = await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const { stream, session, manage, canTake } = await registerContext(tx, actor, input);
    const settings = await settingsIn(tx, actor.schoolId);
    // One register at a time (two phones submitting together).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${stream.id}:${session.id}:${isoDay(input.date)}`}))`;
    const existing = await tx.attendanceRegister.findUnique({
      where: {
        schoolId_streamId_sessionId_date: {
          schoolId: actor.schoolId,
          streamId: stream.id,
          sessionId: session.id,
          date: input.date,
        },
      },
    });
    if (existing) {
      const ok = correctionAllowed({ registerDay: input.date, today, canTake, canManage: manage });
      if (!ok.ok) throw new ValidationError(ok.reason);
    } else if (!sameDay(input.date, today) && !manage) {
      throw new ValidationError("Only today's register can be taken.");
    }

    const students = await tx.student.findMany({
      where: { schoolId: actor.schoolId, streamId: stream.id, status: "active" },
      select: { id: true, firstName: true, lastName: true, boarder: true },
    });
    const leave = await onLeave(
      tx,
      actor.schoolId,
      students.map((s) => s.id),
      atMinute(input.date, session.opensMinute),
      atMinute(input.date, session.cutoffMinute),
    );
    const wanted = new Map<string, MarkStatus>(
      students.map((s) => [
        s.id,
        leave.has(s.id)
          ? "on_leave"
          : absent.has(s.id)
            ? "absent"
            : late.has(s.id)
              ? "late"
              : "present",
      ]),
    );

    const register =
      existing ??
      (await tx.attendanceRegister.create({
        data: {
          schoolId: actor.schoolId,
          streamId: stream.id,
          sessionId: session.id,
          date: input.date,
          submittedAt: now,
          submittedById: actor.userId,
        },
      }));
    const before = existing
      ? await tx.attendanceMark.findMany({
          where: { schoolId: actor.schoolId, registerId: register.id },
          select: { id: true, studentId: true, status: true },
        })
      : [];
    const prior = new Map(before.map((m) => [m.studentId, m]));

    const toCreate = students.filter((s) => !prior.has(s.id));
    if (toCreate.length)
      await tx.attendanceMark.createMany({
        data: toCreate.map((s) => ({
          schoolId: actor.schoolId,
          registerId: register.id,
          studentId: s.id,
          date: input.date,
          status: wanted.get(s.id)!,
          leaveoutId: leave.get(s.id) ?? null,
          markedById: actor.userId,
        })),
      });
    const changed: { studentId: string; from: string; to: MarkStatus }[] = [];
    for (const s of students) {
      const p = prior.get(s.id);
      const to = wanted.get(s.id)!;
      if (p && p.status !== to) {
        changed.push({ studentId: s.id, from: p.status, to });
        await tx.attendanceMark.update({
          where: { schoolId: actor.schoolId, id: p.id },
          data: { status: to, leaveoutId: leave.get(s.id) ?? null, markedById: actor.userId },
        });
      }
    }
    if (existing && changed.length)
      await tx.attendanceRegister.update({
        where: { schoolId: actor.schoolId, id: register.id },
        data: { correctedAt: now },
      });

    // The marks as saved, for the alerts.
    const marks = await tx.attendanceMark.findMany({
      where: { schoolId: actor.schoolId, registerId: register.id },
      select: { id: true, studentId: true, status: true },
    });
    const markOf = new Map(marks.map((m) => [m.studentId, m]));
    const newlyAbsent = students.filter(
      (s) => wanted.get(s.id) === "absent" && prior.get(s.id)?.status !== "absent",
    );
    const noLongerAbsent = changed.filter((c) => c.from === "absent" && c.to !== "absent");

    // A quick correction: nothing goes to the parents (or the boarding staff) any more.
    if (noLongerAbsent.length)
      await tx.absenceAlert.updateMany({
        where: {
          schoolId: actor.schoolId,
          markId: { in: noLongerAbsent.map((c) => markOf.get(c.studentId)!.id) },
          status: "waiting",
        },
        data: { status: "cancelled", resolvedAt: now, resolvedById: actor.userId },
      });

    const due = new Date(now.getTime() + settings.absenceSmsDelayMinutes * 60_000);
    const alerts = newlyAbsent.flatMap((s) => {
      const base = {
        schoolId: actor.schoolId,
        markId: markOf.get(s.id)!.id,
        studentId: s.id,
        date: input.date,
        status: "waiting",
      };
      const out = [];
      if (s.boarder) out.push({ ...base, kind: "boarder", dueAt: null });
      if (s.boarder ? settings.absenceSmsBoarders : settings.absenceSmsDayScholars)
        out.push({ ...base, kind: "parent_sms", dueAt: due });
      return out;
    });
    if (alerts.length) await tx.absenceAlert.createMany({ data: alerts });

    const boarders = newlyAbsent.filter((s) => s.boarder);
    if (boarders.length) {
      await notifyStaffWith(tx, actor.schoolId, ["boarding.alerts", "boarding.manage"], {
        title: `Boarder${boarders.length === 1 ? "" : "s"} absent from class`,
        body: `${streamLabel(stream)}, ${session.name}: ${boarders
          .map((b) => `${b.firstName} ${b.lastName}`)
          .join(", ")}. Check the dormitory and say whether they were found.`,
        link: "/dashboard/attendance/boarders",
      });
    }

    const counts = { present: 0, absent: 0, late: 0, on_leave: 0 };
    for (const v of wanted.values()) counts[v]++;
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: existing ? "attendance.correct" : "attendance.submit",
      targetType: "attendance_register",
      targetId: register.id,
      before: existing
        ? { changes: changed.map((c) => ({ studentId: c.studentId, status: c.from })) }
        : undefined,
      after: existing
        ? { changes: changed.map((c) => ({ studentId: c.studentId, status: c.to })) }
        : {
            stream: streamLabel(stream),
            session: session.name,
            date: isoDay(input.date),
            ...counts,
          },
      ip: actor.ip,
    });
    return { registerId: register.id, counts, corrected: !!existing, changed: changed.length };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Absence alerts
// ---------------------------------------------------------------------------

async function queueStudentSms(
  tx: Tx,
  schoolId: string,
  studentId: string,
  templateKey: string,
  category: "general" | "boarding",
  vars: Record<string, string>,
  now: Date,
  createdById: string,
) {
  const school = await tx.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { name: true },
  });
  const recipients = await guardianRecipients(tx, { schoolId, studentIds: [studentId] }, category);
  const seen = new Set<string>();
  const drafts: Draft[] = recipients
    .filter((r: Recipient) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)))
    .map((r) => ({
      recipient: r,
      templateKey,
      channel: "sms",
      vars: { school: school.name, ...vars },
    }));
  if (!drafts.length) return { queued: 0 };
  const { planned } = await planDrafts(tx, schoolId, drafts);
  return queuePlanned(tx, { schoolId, planned, mode: "each", now, createdById });
}

/**
 * The worker: absence SMS whose delay has passed. Each goes only if the student is still marked
 * absent (a correction in the meantime cancels it). Runs as the school's automatic member.
 */
export async function processAbsenceAlerts(db: PrismaClient, now = new Date()) {
  const schools = await db.$queryRaw<{ id: string }[]>`
    SELECT app_due_absence_alert_schools AS id FROM app_due_absence_alert_schools(${now}::timestamptz)`;
  let sent = 0;
  for (const { id: schoolId } of schools) {
    // One school's problem (e.g. no wallet yet) never holds up another's absence SMS.
    try {
      sent += await sendDueAbsenceSms(db, schoolId, now);
    } catch (err) {
      console.error(`[attendance] absence SMS for school ${schoolId} failed`, err);
    }
  }
  return { sent };
}

async function sendDueAbsenceSms(db: PrismaClient, schoolId: string, now: Date) {
  const sys = await messagingActor(db, schoolId);
  return await withContext(db, { userId: sys.userId, schoolId }, async (tx) => {
    const due = await tx.absenceAlert.findMany({
      where: { schoolId, kind: "parent_sms", status: "waiting", dueAt: { lte: now } },
      select: {
        id: true,
        markId: true,
        studentId: true,
        date: true,
        student: { select: { firstName: true, boarder: true } },
      },
      take: 500,
    });
    const marks = await tx.attendanceMark.findMany({
      where: { schoolId, id: { in: due.map((d) => d.markId) } },
      select: {
        id: true,
        status: true,
        register: { select: { session: { select: { name: true } } } },
      },
    });
    let n = 0;
    for (const a of due) {
      const m = marks.find((x) => x.id === a.markId);
      if (!m || m.status !== "absent") {
        await tx.absenceAlert.update({
          where: { schoolId, id: a.id },
          data: { status: "cancelled", resolvedAt: now },
        });
        continue;
      }
      await queueStudentSms(
        tx,
        schoolId,
        a.studentId,
        a.student.boarder ? "attendance_boarder_absent" : "attendance_absent",
        a.student.boarder ? "boarding" : "general",
        {
          student: firstName(a.student.firstName),
          session: m.register.session.name.toLowerCase(),
          date: dateText(a.date),
        },
        now,
        sys.userId,
      );
      await tx.absenceAlert.update({
        where: { schoolId, id: a.id },
        data: { status: "sent", resolvedAt: now },
      });
      n++;
    }
    return n;
  });
}

/** Boarders marked absent and not yet looked for (the boarding staff's list). */
export async function boarderAlerts({ db }: Deps, actor: Actor, now = new Date()) {
  if (!canHandleBoarderAlerts(actor.permissions) && !canManageAttendance(actor.permissions))
    throw new ForbiddenError("boarding.alerts");
  return withContext(db, ctxOf(actor), async (tx) => {
    const rows = await tx.absenceAlert.findMany({
      where: {
        schoolId: actor.schoolId,
        kind: "boarder",
        OR: [{ status: "waiting" }, { date: nairobiDate(now) }],
      },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        date: true,
        createdAt: true,
        resolvedAt: true,
        note: true,
        markId: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNumber: true,
            house: { select: { name: true } },
            class: { select: { name: true } },
            stream: { select: { name: true } },
          },
        },
      },
    });
    const marks = await tx.attendanceMark.findMany({
      where: { schoolId: actor.schoolId, id: { in: rows.map((r) => r.markId) } },
      select: { id: true, register: { select: { session: { select: { name: true } } } } },
    });
    return rows.map((r) => ({
      ...r,
      session: marks.find((m) => m.id === r.markId)?.register.session.name ?? "",
    }));
  });
}

/** The boarding staff looked for an absent boarder: found, or not found (parents told at once). */
export async function resolveBoarderAlert(
  deps: Deps,
  actor: Actor,
  alertId: string,
  found: boolean,
  note: string | null,
  now = new Date(),
) {
  if (!canHandleBoarderAlerts(actor.permissions)) throw new ForbiddenError("boarding.alerts");
  await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const a = await tx.absenceAlert.findFirst({
      where: { schoolId: actor.schoolId, id: alertId, kind: "boarder" },
      select: {
        id: true,
        status: true,
        studentId: true,
        date: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    if (!a) throw new ValidationError("Alert not found.");
    if (a.status !== "waiting")
      throw new ValidationError("Someone has already answered this alert.");
    await tx.absenceAlert.update({
      where: { schoolId: actor.schoolId, id: a.id },
      data: {
        status: found ? "found" : "not_found",
        resolvedById: actor.userId,
        resolvedAt: now,
        note: note?.slice(0, 300) ?? null,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: found ? "attendance.boarder_found" : "attendance.boarder_not_found",
      targetType: "student",
      targetId: a.studentId,
      after: { alertId: a.id, note },
      ip: actor.ip,
    });
    if (!found) {
      // Critical: goes at night and from an empty wallet (within the overdraft).
      const sys = await messagingActor(deps.db, actor.schoolId);
      await queueStudentSms(
        tx,
        actor.schoolId,
        a.studentId,
        "attendance_not_found",
        "boarding",
        { student: firstName(a.student.firstName) },
        now,
        sys.userId,
      );
      await notifyStaffWith(
        tx,
        actor.schoolId,
        ["attendance.manage", "leaveout.grant"],
        {
          title: "Boarder not found",
          body: `${a.student.firstName} ${a.student.lastName} was absent from class and is not in the dormitory. Parents have been sent an SMS.`,
          link: `/dashboard/students/${a.studentId}`,
        },
        [actor.userId],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboards and reports
// ---------------------------------------------------------------------------

/** Today at a glance for the Director and Principal: totals, each stream, late registers. */
export async function attendanceToday({ db }: Deps, actor: Actor, now = new Date()) {
  if (!canManageAttendance(actor.permissions)) throw new ForbiddenError("attendance.manage");
  const today = nairobiDate(now);
  const minute = nairobiMinute(now);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [sessions, streams, registers, marks, waitingBoarders] = await Promise.all([
      tx.attendanceSession.findMany({
        where: { schoolId: actor.schoolId, active: true },
        orderBy: { position: "asc" },
      }),
      tx.stream.findMany({
        where: {
          schoolId: actor.schoolId,
          class: { level: { enabled: true } },
          students: { some: { status: "active" } },
        },
        select: {
          id: true,
          name: true,
          class: { select: { name: true, levelId: true } },
          classTeacher: { select: { displayName: true } },
        },
        orderBy: [
          { class: { level: { sortOrder: "asc" } } },
          { class: { position: "asc" } },
          { name: "asc" },
        ],
      }),
      tx.attendanceRegister.findMany({
        where: { schoolId: actor.schoolId, date: today },
        select: { id: true, streamId: true, sessionId: true },
      }),
      tx.attendanceMark.groupBy({
        by: ["registerId", "status"],
        where: { schoolId: actor.schoolId, date: today },
        _count: { _all: true },
      }),
      tx.absenceAlert.count({
        where: { schoolId: actor.schoolId, kind: "boarder", status: "waiting" },
      }),
    ]);
    const count = (registerIds: string[], status: MarkStatus) =>
      marks
        .filter((m) => registerIds.includes(m.registerId) && m.status === status)
        .reduce((n, m) => n + m._count._all, 0);
    // "Now" is the latest register that has opened today and been taken by someone (so the
    // afternoon counts once its first register is in); before that, the latest one opened.
    const opened = [...sessions].reverse().filter((s) => minute >= s.opensMinute);
    const current =
      opened.find((s) => registers.some((r) => r.sessionId === s.id)) ?? opened[0] ?? sessions[0];
    const currentIds = registers.filter((r) => r.sessionId === current?.id).map((r) => r.id);
    const week = await settingsIn(tx, actor.schoolId);
    const overdue = isSchoolDay(today, week)
      ? sessions.flatMap((se) =>
          minute > se.cutoffMinute
            ? streams
                .filter(
                  (st) =>
                    isSchoolDay(today, week, st.class.levelId) &&
                    !registers.some((r) => r.streamId === st.id && r.sessionId === se.id),
                )
                .map((st) => ({
                  streamId: st.id,
                  stream: streamLabel(st),
                  session: se.name,
                  sessionId: se.id,
                  teacher: st.classTeacher?.displayName ?? null,
                }))
            : [],
        )
      : [];
    return {
      today,
      session: current ? { id: current.id, name: current.name } : null,
      totals: {
        present: count(currentIds, "present"),
        late: count(currentIds, "late"),
        absent: count(currentIds, "absent"),
        onLeave: count(currentIds, "on_leave"),
      },
      taken: currentIds.length,
      streamsTotal: streams.length,
      streams: streams.map((st) => {
        const ids = registers
          .filter((r) => r.streamId === st.id && r.sessionId === current?.id)
          .map((r) => r.id);
        const present = count(ids, "present") + count(ids, "late");
        const absent = count(ids, "absent");
        return {
          id: st.id,
          label: streamLabel(st),
          taken: ids.length > 0,
          present,
          absent,
          late: count(ids, "late"),
          percent: present + absent ? Math.round((present / (present + absent)) * 100) : null,
        };
      }),
      overdue,
      waitingBoarders,
    };
  });
}

/** The period "this term" means: the current term, else the last four weeks. */
async function periodFor(tx: Tx, schoolId: string, now: Date) {
  const today = nairobiDate(now);
  const term = await tx.term.findFirst({
    where: { schoolId, startDate: { lte: today }, endDate: { gte: today } },
    select: {
      name: true,
      startDate: true,
      endDate: true,
      academicYear: { select: { name: true } },
    },
  });
  if (term)
    return { label: `${term.name} ${term.academicYear.name}`, from: term.startDate, to: today };
  return { label: "Last 4 weeks", from: new Date(today.getTime() - 27 * 86_400_000), to: today };
}

/** One student's attendance this term (the profile). Follows the student's visibility. */
export async function studentAttendance(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  now = new Date(),
): Promise<StudentAttendance> {
  return withContext(db, ctxOf(actor), async (tx) => {
    const period = await periodFor(tx, actor.schoolId, now);
    const marks = await tx.attendanceMark.findMany({
      where: {
        schoolId: actor.schoolId,
        studentId,
        date: { gte: period.from, lte: period.to },
      },
      select: { date: true, status: true },
    });
    return summarise(marks, period);
  });
}

/** Per stream and school: attendance %, frequent absences and late patterns for a period. */
export async function attendanceReport(
  { db }: Deps,
  actor: Actor,
  range: { from?: Date | null; to?: Date | null } = {},
  now = new Date(),
) {
  if (!canManageAttendance(actor.permissions)) throw new ForbiddenError("attendance.manage");
  return withContext(db, ctxOf(actor), async (tx) => {
    const period =
      range.from && range.to
        ? { label: `${isoDay(range.from)} to ${isoDay(range.to)}`, from: range.from, to: range.to }
        : await periodFor(tx, actor.schoolId, now);
    const marks = await tx.attendanceMark.findMany({
      where: { schoolId: actor.schoolId, date: { gte: period.from, lte: period.to } },
      select: {
        date: true,
        status: true,
        studentId: true,
        register: { select: { streamId: true } },
      },
    });
    const [students, streams] = await Promise.all([
      tx.student.findMany({
        where: {
          schoolId: actor.schoolId,
          id: { in: [...new Set(marks.map((m) => m.studentId))] },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          boarder: true,
          class: { select: { name: true } },
          stream: { select: { name: true } },
        },
      }),
      tx.stream.findMany({
        where: { schoolId: actor.schoolId },
        select: { id: true, name: true, class: { select: { name: true } } },
        orderBy: [
          { class: { level: { sortOrder: "asc" } } },
          { class: { position: "asc" } },
          { name: "asc" },
        ],
      }),
    ]);
    const byStudent = new Map<string, { date: Date; status: string }[]>();
    for (const m of marks) byStudent.set(m.studentId, [...(byStudent.get(m.studentId) ?? []), m]);
    const perStudent = students.map((s) => {
      const sum = summarise(byStudent.get(s.id) ?? [], period);
      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNumber: s.admissionNumber,
        className: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
        boarder: s.boarder,
        percent: sum.percent,
        daysAbsent: sum.daysAbsent,
        partDays: sum.partDays,
        lates: sum.lates,
      };
    });
    // The school week's days (Saturday too when any level has Saturday classes), Monday first.
    const week = await settingsIn(tx, actor.schoolId);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const latesByWeekday = [1, 2, 3, 4, 5, 6, 0]
      .filter((i) => week.schoolDays.includes(i) || (i === 6 && week.saturdayLevelIds.length > 0))
      .map((i) => ({
        day: weekdays[i],
        lates: marks.filter((m) => m.status === "late" && m.date.getUTCDay() === i).length,
      }));
    return {
      period,
      school: attendancePercent(marks.map((m) => m.status as MarkStatus)),
      streams: streams
        .map((st) => {
          const ms = marks.filter((m) => m.register.streamId === st.id);
          return {
            id: st.id,
            label: streamLabel(st),
            percent: attendancePercent(ms.map((m) => m.status as MarkStatus)),
            absent: ms.filter((m) => m.status === "absent").length,
            late: ms.filter((m) => m.status === "late").length,
            registers: new Set(ms.map((m) => isoDay(m.date))).size,
          };
        })
        .filter((s) => s.registers > 0),
      frequentAbsences: perStudent
        .filter((s) => s.daysAbsent + s.partDays >= 3)
        .sort((a, b) => b.daysAbsent + b.partDays - (a.daysAbsent + a.partDays)),
      frequentLates: perStudent.filter((s) => s.lates >= 3).sort((a, b) => b.lates - a.lates),
      latesByWeekday,
      perStudent,
    };
  });
}
