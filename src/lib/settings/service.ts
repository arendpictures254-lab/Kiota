/**
 * School settings that are configuration, not code: how early the gate lets a child out, the
 * leave-out reasons, the register times and who is told about an absence. Each change is
 * permission-checked here and written to the audit log.
 *
 *  - school.settings.manage (the Director): leave-out rules and reasons.
 *  - attendance.manage (Principal, Director): register times and absence alerts.
 */
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";

export type SchoolSettingsRow = {
  leaveoutEarlyExitMinutes: number;
  absenceSmsDayScholars: boolean;
  absenceSmsDelayMinutes: number;
  absenceSmsBoarders: boolean;
  cardPhone: string | null;
  cardEmail: string | null;
  cardAddress: string | null;
};

const DEFAULTS: SchoolSettingsRow = {
  leaveoutEarlyExitMinutes: 60,
  absenceSmsDayScholars: true,
  absenceSmsDelayMinutes: 30,
  absenceSmsBoarders: false,
  cardPhone: null,
  cardEmail: null,
  cardAddress: null,
};

/** The school's settings, inside a transaction already in the school's context. */
export async function settingsIn(tx: Tx, schoolId: string): Promise<SchoolSettingsRow> {
  const row = await tx.schoolSettings.findUnique({ where: { schoolId } });
  return row ?? DEFAULTS;
}

export async function getSchoolSettings({ db }: Deps, actor: Actor) {
  return withContext(db, ctxOf(actor), (tx) => settingsIn(tx, actor.schoolId));
}

const int = (v: unknown, field: string, min: number, max: number, label: string) => {
  const n = Number(clean(v));
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`, field);
  return n;
};

const yes = (v: unknown) => v === "on" || v === "true" || v === "1" || v === true;

/** Leave-out rules (Director). */
export async function updateLeaveoutSettings(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
) {
  assertCan(actor.permissions, "school.settings.manage");
  const minutes = int(raw.earlyExitMinutes, "earlyExitMinutes", 0, 720, "Minutes");
  await withContext(db, ctxOf(actor), async (tx) => {
    const before = await settingsIn(tx, actor.schoolId);
    await tx.schoolSettings.update({
      where: { schoolId: actor.schoolId },
      data: { leaveoutEarlyExitMinutes: minutes },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "settings.leaveouts",
      targetType: "school",
      targetId: actor.schoolId,
      before: { earlyExitMinutes: before.leaveoutEarlyExitMinutes },
      after: { earlyExitMinutes: minutes },
      ip: actor.ip,
    });
  });
}

/** Who is told about an absence (Principal, Director). */
export async function updateAbsenceSettings(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
) {
  assertCan(actor.permissions, "attendance.manage");
  const data = {
    absenceSmsDayScholars: yes(raw.daySms),
    absenceSmsDelayMinutes: int(raw.delayMinutes, "delayMinutes", 0, 240, "The delay"),
    absenceSmsBoarders: yes(raw.boarderSms),
  };
  await withContext(db, ctxOf(actor), async (tx) => {
    const before = await settingsIn(tx, actor.schoolId);
    await tx.schoolSettings.update({ where: { schoolId: actor.schoolId }, data });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "settings.attendance",
      targetType: "school",
      targetId: actor.schoolId,
      before: {
        absenceSmsDayScholars: before.absenceSmsDayScholars,
        absenceSmsDelayMinutes: before.absenceSmsDelayMinutes,
        absenceSmsBoarders: before.absenceSmsBoarders,
      },
      after: data,
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Leave-out reasons (the school's list; hidden ones stay on old leave-outs)
// ---------------------------------------------------------------------------

export async function allLeaveoutReasons({ db }: Deps, actor: Actor) {
  return withContext(db, ctxOf(actor), (tx) =>
    tx.leaveoutReason.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, active: true, position: true },
    }),
  );
}

type ReasonChange =
  | { kind: "add"; name: unknown }
  | { kind: "rename"; id: string; name: unknown }
  | { kind: "toggle"; id: string }
  | { kind: "move"; id: string; direction: "up" | "down" };

export async function changeLeaveoutReason({ db }: Deps, actor: Actor, change: ReasonChange) {
  if (!actor.permissions.has("school.settings.manage"))
    throw new ForbiddenError("school.settings.manage");
  await withContext(db, ctxOf(actor), async (tx) => {
    const list = await tx.leaveoutReason.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    const name = "name" in change ? clean(change.name)?.slice(0, 40) : null;
    if ((change.kind === "add" || change.kind === "rename") && !name)
      throw new ValidationError("Type the reason.", "name");
    if (
      name &&
      list.some(
        (r) =>
          r.name.toLowerCase() === name.toLowerCase() && r.id !== ("id" in change ? change.id : ""),
      )
    )
      throw new ValidationError("That reason is already on the list.", "name");
    const target = "id" in change ? list.find((r) => r.id === change.id) : undefined;
    if (change.kind !== "add" && !target) throw new ValidationError("Reason not found.");
    let after: Record<string, unknown> = {};
    switch (change.kind) {
      case "add": {
        const position = (list.at(-1)?.position ?? 0) + 1;
        const row = await tx.leaveoutReason.create({
          data: { schoolId: actor.schoolId, name: name!, position },
        });
        after = { id: row.id, name: row.name };
        break;
      }
      case "rename":
        await tx.leaveoutReason.update({
          where: { id: target!.id, schoolId: actor.schoolId },
          data: { name: name! },
        });
        after = { id: target!.id, name };
        break;
      case "toggle":
        if (target!.active && list.filter((r) => r.active).length === 1)
          throw new ValidationError("Keep at least one reason on the list.");
        await tx.leaveoutReason.update({
          where: { id: target!.id, schoolId: actor.schoolId },
          data: { active: !target!.active },
        });
        after = { id: target!.id, active: !target!.active };
        break;
      case "move": {
        const i = list.findIndex((r) => r.id === target!.id);
        const j = change.direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        const order = [...list];
        [order[i], order[j]] = [order[j], order[i]];
        for (const [k, r] of order.entries()) {
          if (r.position !== k + 1)
            await tx.leaveoutReason.update({
              where: { id: r.id, schoolId: actor.schoolId },
              data: { position: k + 1 },
            });
        }
        after = { id: target!.id, moved: change.direction };
        break;
      }
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: `leaveout_reason.${change.kind}`,
      targetType: "leaveout_reason",
      targetId: "id" in change ? change.id : String(after.id ?? ""),
      before: target ? { name: target.name, active: target.active } : undefined,
      after: after as never,
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Register times
// ---------------------------------------------------------------------------

/** "07:30" → 450. */
export function parseClock(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clean(v) ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** 450 → "07:30". */
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export async function attendanceSessions({ db }: Deps, actor: Actor, all = false) {
  return withContext(db, ctxOf(actor), (tx) =>
    tx.attendanceSession.findMany({
      where: { schoolId: actor.schoolId, ...(all ? {} : { active: true }) },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
  );
}

/** Add or change a register time (name, opens, cut-off, on/off). */
export async function saveAttendanceSession(
  { db }: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
) {
  assertCan(actor.permissions, "attendance.manage");
  const id = clean(raw.id);
  const name = clean(raw.name)?.slice(0, 30);
  if (!name) throw new ValidationError("Give the register a name, e.g. Morning.", "name");
  const opens = parseClock(raw.opens);
  const cutoff = parseClock(raw.cutoff);
  if (opens === null) throw new ValidationError("Enter the time as HH:MM, e.g. 07:30.", "opens");
  if (cutoff === null || cutoff < opens)
    throw new ValidationError("The cut-off must be at or after the start, as HH:MM.", "cutoff");
  const active = raw.active === undefined ? true : yes(raw.active);
  await withContext(db, ctxOf(actor), async (tx) => {
    const others = await tx.attendanceSession.findMany({ where: { schoolId: actor.schoolId } });
    if (others.some((o) => o.name.toLowerCase() === name.toLowerCase() && o.id !== id))
      throw new ValidationError("There is already a register with that name.", "name");
    const data = { name, opensMinute: opens, cutoffMinute: cutoff, active };
    const row = id
      ? await tx.attendanceSession.update({ where: { id, schoolId: actor.schoolId }, data })
      : await tx.attendanceSession.create({
          data: {
            schoolId: actor.schoolId,
            ...data,
            position: Math.max(0, ...others.map((o) => o.position)) + 1,
          },
        });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: id ? "attendance_session.update" : "attendance_session.create",
      targetType: "attendance_session",
      targetId: row.id,
      after: { name, opens: clock(opens), cutoff: clock(cutoff), active },
      ip: actor.ip,
    });
  });
}
