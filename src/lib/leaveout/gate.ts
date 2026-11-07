/**
 * The gate. A guard (gate.scan) sees only passes: never student records, fees, marks or
 * medical notes. The gate phone downloads a bundle (the school's public key and the passes valid
 * today and tomorrow, photos included), checks passes offline, and sends exits and returns here,
 * now or later. Each event is recorded once (the device's own event id); an event that no longer
 * fits (the pass was cancelled while the device was offline, or another device already let the
 * child out) is still recorded as what happened at the gate, flagged as a conflict, and the
 * boarding master is told.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { ensureMessagingMember } from "@/lib/messaging/system";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";
import { settingsIn } from "@/lib/settings/service";
import { getStorage } from "@/lib/storage";
import { leaveoutVars, notifyStaffWith, sendLeaveoutSms } from "./notify";
import { parsePass, pickupCodeHash } from "./pass-token";
import { passVerdict } from "./rules";

export const canUseGate = (actor: Actor) =>
  actor.permissions.has("gate.scan") || actor.permissions.has("boarding.manage");

function assertGate(actor: Actor) {
  if (!canUseGate(actor)) throw new ForbiddenError("gate.scan");
}

/** What the gate needs about a pass (no fees, marks or medical: just enough to check the child). */
const GATE_SELECT = {
  id: true,
  studentId: true,
  status: true,
  studentName: true,
  admissionNumber: true,
  classLabel: true,
  photoKey: true,
  leaveAt: true,
  returnAt: true,
  collectorName: true,
  collectorRelationship: true,
  collectorPhone: true,
  passToken: true,
  pickupCodeHash: true,
  exitedAt: true,
  returnedAt: true,
  decidedById: true,
} as const;

export type GatePass = {
  id: string;
  /** Only to match a scanned ID card to its pass offline (no student details come with it). */
  studentId: string;
  status: string;
  studentName: string;
  admissionNumber: string;
  classLabel: string;
  leaveAt: string;
  returnAt: string;
  collectorName: string;
  collectorRelationship: string;
  collectorPhone: string;
  nonce: string | null;
  pickupCodeHash: string | null;
  exitedAt: string | null;
  returnedAt: string | null;
  approvedBy: string | null;
  photo: string | null;
};

async function photoDataUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  const f = await getStorage()
    .get(key)
    .catch(() => null);
  return f ? `data:${f.contentType};base64,${f.bytes.toString("base64")}` : null;
}

async function toGatePass(
  l: {
    id: string;
    studentId: string;
    status: string;
    studentName: string;
    admissionNumber: string;
    classLabel: string;
    photoKey: string | null;
    leaveAt: Date;
    returnAt: Date;
    collectorName: string;
    collectorRelationship: string;
    collectorPhone: string;
    passToken: string | null;
    pickupCodeHash: string | null;
    exitedAt: Date | null;
    returnedAt: Date | null;
  },
  approvedBy: string | null,
  withPhoto: boolean,
): Promise<GatePass> {
  return {
    id: l.id,
    studentId: l.studentId,
    status: l.status,
    studentName: l.studentName,
    admissionNumber: l.admissionNumber,
    classLabel: l.classLabel,
    leaveAt: l.leaveAt.toISOString(),
    returnAt: l.returnAt.toISOString(),
    collectorName: l.collectorName,
    collectorRelationship: l.collectorRelationship,
    collectorPhone: l.collectorPhone,
    nonce: l.passToken ? (parsePass(l.passToken)?.nonce ?? null) : null,
    pickupCodeHash: l.pickupCodeHash,
    exitedAt: l.exitedAt?.toISOString() ?? null,
    returnedAt: l.returnedAt?.toISOString() ?? null,
    approvedBy,
    photo: withPhoto ? await photoDataUrl(l.photoKey) : null,
  };
}

async function approverNames(db: PrismaClient, actor: Actor, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const ms = await withContext(db, ctxOf(actor), (tx) =>
    tx.membership.findMany({
      where: { schoolId: actor.schoolId, userId: { in: list } },
      select: { userId: true, displayName: true },
    }),
  );
  return new Map(ms.map((m) => [m.userId, m.displayName]));
}

/** A student ID card as the gate phone keeps it (offline checks). Replaced cards carry no name. */
export type GateCard = {
  id: string;
  nonce: string;
  live: boolean;
  studentId: string;
  name: string | null;
  admissionNumber: string | null;
  classLabel: string | null;
  boarder: boolean | null;
};

/** Everything the gate phone needs to work offline today and tomorrow. */
export async function gateBundle({ db }: Deps, actor: Actor, now = new Date()) {
  assertGate(actor);
  const { key, school, rows, settings, cards } = await withContext(
    db,
    ctxOf(actor),
    async (tx) => ({
      settings: await settingsIn(tx, actor.schoolId),
      // Student ID cards, for checking a card offline: who it belongs to, or that it was replaced.
      cards: await tx.$queryRaw<
        {
          card_id: string;
          nonce: string;
          live: boolean;
          valid_until_year: number;
          student_id: string;
          first_name: string | null;
          last_name: string | null;
          admission_number: string | null;
          class_label: string | null;
          boarder: boolean | null;
        }[]
      >`SELECT * FROM app_gate_cards()`,
      key: await tx.leaveoutPassKey.findUnique({ where: { schoolId: actor.schoolId } }),
      school: await tx.school.findUniqueOrThrow({
        where: { id: actor.schoolId },
        select: { id: true, name: true },
      }),
      rows: await tx.leaveout.findMany({
        where: {
          schoolId: actor.schoolId,
          OR: [
            { status: "out" },
            {
              status: { in: ["approved", "cancelled", "returned"] },
              leaveAt: { lt: new Date(now.getTime() + 2 * 86_400_000) },
              returnAt: { gt: new Date(now.getTime() - 86_400_000) },
            },
          ],
        },
        select: GATE_SELECT,
        orderBy: { leaveAt: "asc" },
        take: 2000,
      }),
    }),
  );
  const names = await approverNames(
    db,
    actor,
    rows.map((r) => r.decidedById),
  );
  const passes = await Promise.all(
    rows.map((r) =>
      toGatePass(
        r,
        r.decidedById ? (names.get(r.decidedById) ?? null) : null,
        r.status !== "cancelled",
      ),
    ),
  );
  return {
    school,
    publicKey: key?.publicKey ?? null,
    generatedAt: now.toISOString(),
    /** The school's rule: how early before the leave time a child may go. */
    earlyExitMinutes: settings.leaveoutEarlyExitMinutes,
    cards: cards.map((c): GateCard => ({
      id: c.card_id,
      nonce: c.nonce,
      live: c.live,
      studentId: c.student_id,
      name: c.live ? `${c.first_name} ${c.last_name}` : null,
      admissionNumber: c.admission_number,
      classLabel: c.class_label,
      boarder: c.boarder,
    })),
    passes,
  };
}

/** One pass, fresh from the server (a pass approved after the bundle was downloaded). */
export async function gatePass({ db }: Deps, actor: Actor, token: string) {
  assertGate(actor);
  const p = parsePass(token);
  if (!p || p.schoolId !== actor.schoolId) return null;
  const row = await withContext(db, ctxOf(actor), (tx) =>
    tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: p.leaveoutId },
      select: GATE_SELECT,
    }),
  );
  if (!row || row.passToken !== token) return null;
  const names = await approverNames(db, actor, [row.decidedById]);
  return toGatePass(row, row.decidedById ? (names.get(row.decidedById) ?? null) : null, true);
}

/** When the QR code is damaged: find today's passes by name or admission number. */
export async function searchGatePasses({ db }: Deps, actor: Actor, q: string, now = new Date()) {
  assertGate(actor);
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await withContext(db, ctxOf(actor), (tx) =>
    tx.leaveout.findMany({
      where: {
        schoolId: actor.schoolId,
        status: { in: ["approved", "out", "cancelled", "returned"] },
        returnAt: { gt: new Date(now.getTime() - 86_400_000) },
        OR: [
          { studentName: { contains: term, mode: "insensitive" } },
          { admissionNumber: { contains: term, mode: "insensitive" } },
        ],
      },
      select: GATE_SELECT,
      orderBy: { leaveAt: "asc" },
      take: 10,
    }),
  );
  const names = await approverNames(
    db,
    actor,
    rows.map((r) => r.decidedById),
  );
  return Promise.all(
    rows.map((r) => toGatePass(r, r.decidedById ? (names.get(r.decidedById) ?? null) : null, true)),
  );
}

// ---------------------------------------------------------------------------
// Exits and returns
// ---------------------------------------------------------------------------

export type GateEventInput = {
  /** The device's own id for this event (a repeat sync records it once). */
  id: string;
  leaveoutId: string;
  kind: "exit" | "return";
  /** When it happened at the gate (ISO). */
  at: string;
  /** The collector's pickup code (exits). */
  code?: string;
  /** Recorded while the device had no connection. */
  offline?: boolean;
};

export type GateEventResult = {
  id: string;
  ok: boolean;
  /** Recorded, but it did not fit: the boarding master is told. */
  conflict?: string;
  /** Not recorded (e.g. a wrong pickup code, checked online). */
  error?: string;
};

export async function recordGateEvents(
  deps: Deps,
  actor: Actor,
  events: GateEventInput[],
  now = new Date(),
): Promise<GateEventResult[]> {
  assertGate(actor);
  if (events.length > 500) throw new ValidationError("Too many events in one sync.");
  const results: GateEventResult[] = [];
  for (const e of events) results.push(await recordOne(deps, actor, e, now));
  return results;
}

async function recordOne(
  deps: Deps,
  actor: Actor,
  e: GateEventInput,
  now: Date,
): Promise<GateEventResult> {
  if (!/^[0-9a-f-]{36}$/i.test(e.leaveoutId) || !["exit", "return"].includes(e.kind) || !e.id)
    return { id: e.id, ok: false, error: "Not a valid gate event." };
  let at = new Date(e.at);
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 5 * 60_000) at = now; // a wrong clock
  const offline = !!e.offline;

  const outcome = await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const seen = await tx.leaveoutEvent.findUnique({
      where: {
        schoolId_deviceEventId: { schoolId: actor.schoolId, deviceEventId: e.id.slice(0, 80) },
      },
    });
    if (seen)
      return {
        result: { id: e.id, ok: true, conflict: seen.conflict ?? undefined } as GateEventResult,
        sms: null,
      };
    const [l] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM leaveouts WHERE school_id = ${actor.schoolId}::uuid AND id = ${e.leaveoutId}::uuid FOR UPDATE`;
    if (!l) return { result: { id: e.id, ok: false, error: "Pass not found." }, sms: null };
    const row = await tx.leaveout.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: e.leaveoutId },
    });

    let conflict: string | null = null;
    let change: Record<string, unknown> | null = null;
    if (e.kind === "exit") {
      const codeOk =
        !!row.pickupCodeHash &&
        !!e.code &&
        (await pickupCodeHash(row.id, e.code)) === row.pickupCodeHash;
      if (!codeOk) {
        if (!offline)
          return { result: { id: e.id, ok: false, error: "Wrong pickup code." }, sms: null };
        conflict = "The pickup code entered offline does not match.";
      }
      const v = passVerdict(
        row,
        at,
        (await settingsIn(tx, actor.schoolId)).leaveoutEarlyExitMinutes,
      );
      if (row.status === "out" || row.status === "returned") {
        conflict = "Already let out (another gate device or a repeated scan).";
      } else if (!v.valid) {
        if (!offline)
          return { result: { id: e.id, ok: false, error: `Not valid: ${v.reason}.` }, sms: null };
        conflict =
          row.status === "cancelled"
            ? "The pass was cancelled while the gate was offline, but the student was let out."
            : `The student was let out on a pass that was not valid (${v.reason}).`;
      }
      if (row.status !== "out" && row.status !== "returned") {
        change = { status: "out", exitedAt: at, exitById: actor.userId };
      }
    } else {
      if (row.status === "returned") {
        conflict = "Already marked back (another gate device or a repeated scan).";
      } else if (row.status !== "out") {
        if (!offline && row.status !== "approved")
          return { result: { id: e.id, ok: false, error: "This student is not out." }, sms: null };
        conflict =
          row.status === "approved"
            ? "Marked back without an exit on record."
            : `Marked back on a ${row.status} pass.`;
        change = { status: "returned", returnedAt: at, returnById: actor.userId };
      } else {
        change = { status: "returned", returnedAt: at, returnById: actor.userId };
      }
    }

    await tx.leaveoutEvent.create({
      data: {
        schoolId: actor.schoolId,
        leaveoutId: row.id,
        kind: e.kind,
        at,
        byId: actor.userId,
        deviceEventId: e.id.slice(0, 80),
        offline,
        conflict,
      },
    });
    if (change) {
      await tx.leaveout.update({ where: { schoolId: actor.schoolId, id: row.id }, data: change });
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: e.kind === "exit" ? "leaveout.exit" : "leaveout.return",
      targetType: "leaveout",
      targetId: row.id,
      before: { status: row.status },
      after: {
        status: change?.status ?? row.status,
        at,
        offline,
        ...(conflict ? { conflict } : {}),
      },
      ip: actor.ip,
    });
    if (conflict) {
      await notifyStaffWith(tx, actor.schoolId, ["boarding.manage"], {
        title: "Gate conflict",
        body: `${row.studentName} (${row.classLabel}), ${e.kind === "exit" ? "exit" : "return"}: ${conflict}`,
        link: `/dashboard/leaveouts/${row.id}`,
      });
    }
    // Parents hear about real movements only (not a duplicate scan).
    const sms = change ? { kind: e.kind, row } : null;
    return {
      result: { id: e.id, ok: true, conflict: conflict ?? undefined } as GateEventResult,
      sms,
    };
  });

  if (outcome.sms) {
    const l = outcome.sms.row;
    if (outcome.sms.kind === "exit") {
      await sendLeaveoutSms(
        deps.db,
        l,
        "leaveout_exit",
        "parents",
        () => ({
          time: leaveoutVars.time(at),
          collector: l.collectorName,
        }),
        { now },
      );
    } else {
      await sendLeaveoutSms(
        deps.db,
        l,
        "leaveout_return",
        "parents",
        () => ({ time: leaveoutVars.time(at) }),
        { now },
      );
    }
  }
  return outcome.result;
}

/** Photo of the student on a pass (staff with leave-out access or the gate). */
export async function leaveoutPhoto({ db }: Deps, actor: Actor, leaveoutId: string) {
  if (
    !canUseGate(actor) &&
    !actor.permissions.has("leaveout.request") &&
    !actor.permissions.has("leaveout.approve")
  )
    throw new ForbiddenError("gate.scan");
  if (!/^[0-9a-f-]{36}$/i.test(leaveoutId)) return null;
  const row = await withContext(db, ctxOf(actor), (tx) =>
    tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: leaveoutId },
      select: { photoKey: true },
    }),
  );
  return row?.photoKey ? getStorage().get(row.photoKey) : null;
}

/**
 * A student's leave-outs the gate can act on now (approved, or out): used when a guard scans the
 * student's ID card instead of a pass. Newest first.
 */
export async function gatePassesForStudent({ db }: Deps, actor: Actor, studentId: string) {
  assertGate(actor);
  const rows = await withContext(db, ctxOf(actor), (tx) =>
    tx.leaveout.findMany({
      where: { schoolId: actor.schoolId, studentId, status: { in: ["approved", "out"] } },
      select: { ...GATE_SELECT, studentId: true },
      orderBy: { leaveAt: "desc" },
      take: 3,
    }),
  );
  const names = await approverNames(
    db,
    actor,
    rows.map((r) => r.decidedById),
  );
  return Promise.all(
    rows.map((r) => toGatePass(r, r.decidedById ? (names.get(r.decidedById) ?? null) : null, true)),
  );
}
