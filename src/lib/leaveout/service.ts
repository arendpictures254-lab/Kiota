/**
 * Leave-outs (exeat), staff side: request, approve or decline, cancel, half-term passes, the
 * "who is out" board, history and reports, and the overdue check. Every action checks
 * permissions here (not only in the UI), runs in the school's row-level-security context and
 * writes the audit log in the same transaction.
 *
 *  - leaveout.request: class teachers, boarding master, matron (and the Director) raise requests.
 *  - leaveout.approve: granted person by person by the Director; approves, declines, half term.
 *  - boarding.manage: the who-is-out board, reports, gate conflicts.
 * The collector must be a guardian marked "authorised to collect", or another person a parent
 * approves (SMS reply "YES 1234" or in the portal) before an approver can approve.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import type { PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Draft, planDrafts, queuePlanned, type Recipient } from "@/lib/messaging/outbox";
import { resolveAudience } from "@/lib/messaging/service";
import { ensureMessagingMember, messagingActor } from "@/lib/messaging/system";
import { normalizePhone } from "@/lib/phone";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { signPass } from "./keys";
import { leaveoutVars, notifyStaffWith, notifyUser, sendLeaveoutSms } from "./notify";
import { pickupCodeHash } from "./pass-token";
import { nairobiInput, pickupCode, whenText } from "./rules";

type Perms = ReadonlySet<PermissionKey>;
export const canRequestLeaveouts = (p: Perms) =>
  p.has("leaveout.request") || p.has("leaveout.approve");
export const canApproveLeaveouts = (p: Perms) => p.has("leaveout.approve");
export const canManageBoarding = (p: Perms) =>
  p.has("boarding.manage") || p.has("leaveout.approve");
export const canSeeLeaveouts = (p: Perms) => canRequestLeaveouts(p) || canManageBoarding(p);

const MAX_DAYS = 31;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type LeaveoutInput = {
  studentId: string;
  reasonId: string;
  details: string | null;
  leaveAt: Date;
  returnAt: Date;
  collector: { linkId: string } | { name: string; phone: string; relationship: string };
};

export function parseLeaveoutInput(raw: Record<string, unknown>, now = new Date()): LeaveoutInput {
  const studentId = clean(raw.studentId);
  if (!studentId) throw new ValidationError("Choose the student.", "studentId");
  const reasonId = clean(raw.reasonId);
  if (!reasonId) throw new ValidationError("Choose a reason.", "reasonId");
  const leaveAt = nairobiInput(String(raw.leaveAt ?? ""));
  if (!leaveAt) throw new ValidationError("Enter when the student leaves.", "leaveAt");
  const returnAt = nairobiInput(String(raw.returnAt ?? ""));
  if (!returnAt) throw new ValidationError("Enter when the student comes back.", "returnAt");
  if (returnAt <= leaveAt)
    throw new ValidationError("The return must be after the leave time.", "returnAt");
  if (leaveAt.getTime() < now.getTime() - 3600_000)
    throw new ValidationError("The leave time has already passed.", "leaveAt");
  if (returnAt.getTime() - leaveAt.getTime() > MAX_DAYS * 86_400_000)
    throw new ValidationError(`A leave-out can last at most ${MAX_DAYS} days.`, "returnAt");
  const pick = clean(raw.collector);
  let collector: LeaveoutInput["collector"];
  if (pick && pick.startsWith("link:")) {
    collector = { linkId: pick.slice(5) };
  } else if (pick === "other") {
    const name = clean(raw.otherName);
    const phone = normalizePhone(String(raw.otherPhone ?? ""));
    const relationship = clean(raw.otherRelationship);
    if (!name) throw new ValidationError("Enter the collector's name.", "otherName");
    if (!phone || !phone.startsWith("+254"))
      throw new ValidationError("Enter the collector's Kenyan phone number.", "otherPhone");
    if (!relationship)
      throw new ValidationError("Enter how they are related to the student.", "otherRelationship");
    collector = { name: name.slice(0, 80), phone, relationship: relationship.slice(0, 40) };
  } else {
    throw new ValidationError("Choose who is collecting the student.", "collector");
  }
  return {
    studentId,
    reasonId,
    details: clean(raw.details)?.slice(0, 300) ?? null,
    leaveAt,
    returnAt,
    collector,
  };
}

/** Name, admission number, class and photo copied onto the leave-out for the gate. */
async function snapshot(tx: Tx, schoolId: string, studentId: string) {
  const s = await tx.student.findUnique({
    where: { schoolId, id: studentId },
    select: {
      id: true,
      status: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      photoKey: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
    },
  });
  if (!s || s.status !== "active") return null;
  return {
    studentName: `${s.firstName} ${s.lastName}`,
    admissionNumber: s.admissionNumber,
    classLabel: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
    photoKey: s.photoKey,
  };
}

/** Guardians of a student the school marked "authorised to collect". */
export async function authorisedCollectors({ db }: Deps, actor: Actor, studentId: string) {
  if (!canRequestLeaveouts(actor.permissions)) throw new ForbiddenError("leaveout.request");
  return withContext(db, ctxOf(actor), (tx) =>
    tx.guardianLink.findMany({
      where: { schoolId: actor.schoolId, studentId, authorisedToCollect: true },
      select: { id: true, name: true, relationship: true, user: { select: { phone: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export async function leaveoutReasons({ db }: Deps, actor: Actor) {
  return withContext(db, ctxOf(actor), (tx) =>
    tx.leaveoutReason.findMany({
      where: { schoolId: actor.schoolId, active: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  );
}

export async function requestLeaveout(
  deps: Deps,
  actor: Actor,
  input: LeaveoutInput,
  now = new Date(),
) {
  if (!canRequestLeaveouts(actor.permissions)) throw new ForbiddenError("leaveout.request");
  const created = await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const snap = await snapshot(tx, actor.schoolId, input.studentId);
    if (!snap) throw new ValidationError("Student not found.", "studentId");
    const reason = await tx.leaveoutReason.findFirst({
      where: { schoolId: actor.schoolId, id: input.reasonId, active: true },
    });
    if (!reason) throw new ValidationError("Choose a reason.", "reasonId");
    let collector: {
      kind: string;
      linkId: string | null;
      name: string;
      phone: string;
      relationship: string;
    };
    if ("linkId" in input.collector) {
      const link = await tx.guardianLink.findFirst({
        where: { schoolId: actor.schoolId, id: input.collector.linkId, studentId: input.studentId },
        select: {
          id: true,
          name: true,
          relationship: true,
          authorisedToCollect: true,
          user: { select: { phone: true } },
        },
      });
      if (!link || !link.authorisedToCollect)
        throw new ValidationError(
          "This guardian is not marked as authorised to collect. Choose another, or name someone for the parent to approve.",
          "collector",
        );
      collector = {
        kind: "guardian",
        linkId: link.id,
        name: link.name,
        phone: link.user.phone,
        relationship: link.relationship,
      };
    } else {
      collector = { kind: "other", linkId: null, ...input.collector };
    }
    const confirmCode = collector.kind === "other" ? pickupCode() : null;
    const row = await tx.leaveout.create({
      data: {
        schoolId: actor.schoolId,
        studentId: input.studentId,
        reasonId: reason.id,
        reason: reason.name,
        details: input.details,
        leaveAt: input.leaveAt,
        returnAt: input.returnAt,
        collectorKind: collector.kind,
        collectorLinkId: collector.linkId,
        collectorName: collector.name,
        collectorPhone: collector.phone,
        collectorRelationship: collector.relationship,
        collectorConfirmCode: confirmCode,
        status: collector.kind === "other" ? "awaiting_parent" : "pending",
        requestedVia: "staff",
        requestedById: actor.userId,
        ...snap,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "leaveout.request",
      targetType: "leaveout",
      targetId: row.id,
      after: {
        studentId: row.studentId,
        reason: row.reason,
        leaveAt: row.leaveAt,
        returnAt: row.returnAt,
        collector: row.collectorName,
        collectorKind: row.collectorKind,
      },
      ip: actor.ip,
    });
    if (row.status === "pending") {
      await notifyStaffWith(
        tx,
        actor.schoolId,
        ["leaveout.approve"],
        {
          title: "Leave-out to approve",
          body: `${row.studentName} (${row.classLabel}): ${row.reason}, ${whenText(row.leaveAt)}.`,
          link: `/dashboard/leaveouts/${row.id}`,
        },
        [actor.userId],
      );
    }
    return row;
  });
  // Another collector: the parent approves first (SMS reply or the portal).
  if (created.status === "awaiting_parent") {
    await sendLeaveoutSms(
      deps.db,
      created,
      "leaveout_collector_confirm",
      "parents",
      (lang) => ({
        collector: created.collectorName,
        phone: created.collectorPhone.replace(/^\+254/, "0"),
        date: whenText(created.leaveAt, lang),
        code: created.collectorConfirmCode!,
      }),
      { now },
    );
  }
  return created;
}

/** After a parent's YES (SMS or portal): tell the approvers there is a request to look at. */
export async function collectorApproved(db: PrismaClient, schoolId: string, leaveoutId: string) {
  const actor = await messagingActor(db, schoolId);
  await withContext(db, { userId: actor.userId, schoolId }, async (tx) => {
    const l = await tx.leaveout.findUnique({ where: { schoolId, id: leaveoutId } });
    if (!l) return;
    if (l.status === "pending") {
      await notifyStaffWith(tx, schoolId, ["leaveout.approve"], {
        title: "Leave-out to approve",
        body: `${l.studentName} (${l.classLabel}): the parent approved ${l.collectorName} to collect.`,
        link: `/dashboard/leaveouts/${l.id}`,
      });
    } else if (l.status === "declined") {
      await notifyUser(tx, schoolId, l.requestedById, {
        title: "Leave-out declined by the parent",
        body: `${l.studentName}: ${l.declineReason ?? "The parent did not approve the collector."}`,
        link: `/dashboard/leaveouts/${l.id}`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Approve, decline, cancel
// ---------------------------------------------------------------------------

/** Approve: issue the signed gate pass and the collector's pickup code. */
export async function approveLeaveout(
  deps: Deps,
  actor: Actor,
  leaveoutId: string,
  now = new Date(),
) {
  assertCan(actor.permissions, "leaveout.approve");
  const code = pickupCode();
  const l = await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const row = await tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: leaveoutId },
    });
    if (!row) throw new ValidationError("Leave-out not found.");
    if (row.status === "awaiting_parent")
      throw new ValidationError("The parent has not approved the collector yet.");
    if (row.status !== "pending")
      throw new ValidationError("This leave-out is not waiting for approval.");
    if (row.returnAt <= now)
      throw new ValidationError("The return time has passed. Ask for a new request.");
    const passToken = await signPass(tx, actor.schoolId, row.id);
    const changed = await tx.leaveout.updateMany({
      where: { schoolId: actor.schoolId, id: row.id, status: "pending" },
      data: {
        status: "approved",
        decidedById: actor.userId,
        decidedAt: now,
        passToken,
        pickupCodeHash: await pickupCodeHash(row.id, code),
      },
    });
    if (changed.count === 0)
      throw new ValidationError("This leave-out is not waiting for approval.");
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "leaveout.approve",
      targetType: "leaveout",
      targetId: row.id,
      before: { status: "pending" },
      after: { status: "approved", collector: row.collectorName },
      ip: actor.ip,
    });
    if (row.requestedVia === "staff" && row.requestedById !== actor.userId) {
      await notifyUser(tx, actor.schoolId, row.requestedById, {
        title: "Leave-out approved",
        body: `${row.studentName}: approved, ${whenText(row.leaveAt)} to ${whenText(row.returnAt)}.`,
        link: `/dashboard/leaveouts/${row.id}`,
      });
    }
    return row;
  });
  await sendLeaveoutSms(
    deps.db,
    l,
    "leaveout_pickup_code",
    "collector",
    (lang) => ({
      code,
      date: whenText(l.leaveAt, lang),
    }),
    { now },
  );
  await sendLeaveoutSms(
    deps.db,
    l,
    "leaveout_approved",
    "parents",
    (lang) => ({
      leave: whenText(l.leaveAt, lang),
      return: whenText(l.returnAt, lang),
      collector: l.collectorName,
    }),
    { now },
  );
  return { id: l.id, pickupCode: code };
}

export async function declineLeaveout(
  deps: Deps,
  actor: Actor,
  leaveoutId: string,
  rawReason: unknown,
  now = new Date(),
) {
  assertCan(actor.permissions, "leaveout.approve");
  const reason = clean(rawReason);
  if (!reason) throw new ValidationError("Give a reason for declining.", "reason");
  const l = await withContext(deps.db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    const row = await tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: leaveoutId },
    });
    if (!row || !["pending", "awaiting_parent"].includes(row.status))
      throw new ValidationError("This leave-out is not waiting for approval.");
    await tx.leaveout.update({
      where: { schoolId: actor.schoolId, id: row.id },
      data: {
        status: "declined",
        decidedById: actor.userId,
        decidedAt: now,
        declineReason: reason.slice(0, 300),
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "leaveout.decline",
      targetType: "leaveout",
      targetId: row.id,
      before: { status: row.status },
      after: { status: "declined", reason },
      ip: actor.ip,
    });
    if (row.requestedVia === "staff" && row.requestedById !== actor.userId) {
      await notifyUser(tx, actor.schoolId, row.requestedById, {
        title: "Leave-out declined",
        body: `${row.studentName}: ${reason}`,
        link: `/dashboard/leaveouts/${row.id}`,
      });
    }
    return row;
  });
  await sendLeaveoutSms(deps.db, l, "leaveout_declined", "parents", () => ({ reason }), { now });
}

/** Cancel before the child leaves: the pass stops working at once (also at the gate). */
export async function cancelLeaveout(
  deps: Deps,
  actor: Actor,
  leaveoutId: string,
  rawReason: unknown,
  now = new Date(),
) {
  const reason = clean(rawReason) ?? "Cancelled";
  await withContext(deps.db, ctxOf(actor), async (tx) => {
    const row = await tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: leaveoutId },
    });
    if (!row) throw new ValidationError("Leave-out not found.");
    const mayCancel =
      canApproveLeaveouts(actor.permissions) ||
      actor.permissions.has("boarding.manage") ||
      (canRequestLeaveouts(actor.permissions) && row.requestedById === actor.userId);
    if (!mayCancel) throw new ForbiddenError("leaveout.approve");
    if (!["awaiting_parent", "pending", "approved"].includes(row.status))
      throw new ValidationError(
        row.status === "out"
          ? "The student has already left: record the return at the gate."
          : "This leave-out cannot be cancelled.",
      );
    await tx.leaveout.update({
      where: { schoolId: actor.schoolId, id: row.id },
      data: {
        status: "cancelled",
        cancelledById: actor.userId,
        cancelledAt: now,
        cancelReason: reason.slice(0, 300),
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "leaveout.cancel",
      targetType: "leaveout",
      targetId: row.id,
      before: { status: row.status },
      after: { status: "cancelled", reason },
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Half term: approved passes for a whole class, level or all boarders in one go
// ---------------------------------------------------------------------------

export async function halfTermPasses(
  deps: Deps,
  actor: Actor,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  assertCan(actor.permissions, "leaveout.approve");
  const audience = clean(raw.audience);
  if (!audience) throw new ValidationError("Choose who goes on half term.", "audience");
  const reasonId = clean(raw.reasonId);
  const leaveAt = nairobiInput(String(raw.leaveAt ?? ""));
  const returnAt = nairobiInput(String(raw.returnAt ?? ""));
  if (!leaveAt) throw new ValidationError("Enter when they leave.", "leaveAt");
  if (!returnAt || returnAt <= leaveAt)
    throw new ValidationError("The return must be after the leave time.", "returnAt");

  const result = await withContext(
    deps.db,
    ctxOf(actor),
    async (tx) => {
      await ensureMessagingMember(tx, actor.schoolId);
      const reason = reasonId
        ? await tx.leaveoutReason.findFirst({ where: { schoolId: actor.schoolId, id: reasonId } })
        : await tx.leaveoutReason.findFirst({
            where: { schoolId: actor.schoolId, name: "Half term" },
          });
      if (!reason) throw new ValidationError("Choose a reason.", "reasonId");
      const target = await resolveAudience(tx, actor.schoolId, audience);
      const students = await tx.student.findMany({
        where: { schoolId: actor.schoolId, status: "active", ...target.where },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          photoKey: true,
          class: { select: { name: true } },
          stream: { select: { name: true } },
          guardians: {
            where: { schoolId: actor.schoolId, authorisedToCollect: true },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              id: true,
              name: true,
              relationship: true,
              language: true,
              user: { select: { phone: true } },
            },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      const busy = new Set(
        (
          await tx.leaveout.findMany({
            where: {
              schoolId: actor.schoolId,
              studentId: { in: students.map((s) => s.id) },
              status: { in: ["approved", "out"] },
            },
            select: { studentId: true },
          })
        ).map((x) => x.studentId),
      );
      const batch = { id: randomUUID() };
      const rows = [];
      const codes = new Map<string, string>();
      const langs = new Map<string, "en" | "sw">();
      const skipped: { name: string; why: string }[] = [];
      for (const s of students) {
        const name = `${s.firstName} ${s.lastName}`;
        const c = s.guardians[0];
        if (busy.has(s.id)) {
          skipped.push({ name, why: "already has a pass" });
          continue;
        }
        if (!c) {
          skipped.push({ name, why: "no guardian marked authorised to collect" });
          continue;
        }
        const id = randomUUID();
        const code = pickupCode();
        codes.set(id, code);
        langs.set(id, c.language === "sw" ? "sw" : "en");
        rows.push({
          id,
          schoolId: actor.schoolId,
          studentId: s.id,
          reasonId: reason.id,
          reason: reason.name,
          leaveAt,
          returnAt,
          collectorKind: "guardian",
          collectorLinkId: c.id,
          collectorName: c.name,
          collectorPhone: c.user.phone,
          collectorRelationship: c.relationship,
          status: "approved",
          requestedVia: "bulk",
          requestedById: actor.userId,
          decidedById: actor.userId,
          decidedAt: now,
          passToken: await signPass(tx, actor.schoolId, id),
          pickupCodeHash: await pickupCodeHash(id, code),
          studentName: name,
          admissionNumber: s.admissionNumber,
          classLabel: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
          photoKey: s.photoKey,
          batchId: batch.id,
        });
      }
      if (rows.length) {
        await tx.leaveout.createMany({ data: rows });
      }
      await tx.leaveoutBatch.create({
        data: {
          id: batch.id,
          schoolId: actor.schoolId,
          title: `${reason.name}: ${target.label}`,
          audience: { value: audience, label: target.label },
          created: rows.length,
          skipped: skipped.length,
          createdById: actor.userId,
        },
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "leaveout.bulk_approve",
        targetType: "leaveout_batch",
        targetId: batch.id,
        after: {
          audience: target.label,
          reason: reason.name,
          leaveAt,
          returnAt,
          created: rows.length,
          skipped: skipped.length,
        },
        ip: actor.ip,
      });
      return { batchId: batch.id, label: target.label, rows, codes, langs, skipped };
    },
    { timeoutMs: 120_000 },
  );

  // Every collector gets their pickup code (one transaction, set-based queueing).
  if (result.rows.length) {
    const sys = await messagingActor(deps.db, actor.schoolId);
    await withContext(
      deps.db,
      { userId: sys.userId, schoolId: actor.schoolId },
      async (tx) => {
        const school = await tx.school.findUniqueOrThrow({
          where: { id: actor.schoolId },
          select: { name: true },
        });
        const drafts: Draft[] = result.rows.map((r) => ({
          recipient: {
            guardianLinkId: r.collectorLinkId,
            studentId: r.studentId,
            phone: r.collectorPhone,
            language: result.langs.get(r.id) ?? "en",
            whatsapp: false,
          } satisfies Recipient,
          templateKey: "leaveout_pickup_code",
          channel: "sms",
          vars: {
            school: school.name,
            student: r.studentName.split(" ")[0],
            code: result.codes.get(r.id)!,
            date: whenText(r.leaveAt, result.langs.get(r.id) ?? "en"),
          },
        }));
        const { planned } = await planDrafts(tx, actor.schoolId, drafts);
        await queuePlanned(tx, {
          schoolId: actor.schoolId,
          planned,
          mode: "each",
          now,
          createdById: sys.userId,
        });
      },
      { timeoutMs: 120_000 },
    );
  }
  return {
    batchId: result.batchId,
    label: result.label,
    created: result.rows.length,
    skipped: result.skipped,
  };
}

// ---------------------------------------------------------------------------
// Lists, detail, history, reports
// ---------------------------------------------------------------------------

/** Staff names as this school knows them (memberships.display_name), by user id. */
async function staffNames(tx: Tx, schoolId: string, userIds: (string | null)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const ms = await tx.membership.findMany({
    where: { schoolId, userId: { in: ids } },
    select: { userId: true, displayName: true },
  });
  return new Map(ms.map((m) => [m.userId, m.displayName]));
}

const LIST_SELECT = {
  id: true,
  status: true,
  studentId: true,
  studentName: true,
  admissionNumber: true,
  classLabel: true,
  reason: true,
  leaveAt: true,
  returnAt: true,
  collectorName: true,
  collectorRelationship: true,
  collectorKind: true,
  requestedVia: true,
  requestedById: true,
  decidedById: true,
  exitedAt: true,
  returnedAt: true,
} as const;

export async function leaveoutLists({ db }: Deps, actor: Actor, now = new Date()) {
  if (!canSeeLeaveouts(actor.permissions)) throw new ForbiddenError("leaveout.request");
  return withContext(db, ctxOf(actor), async (tx) => {
    const dayStart = new Date(now.getTime() - 12 * 3600_000);
    const [waiting, out, today] = await Promise.all([
      tx.leaveout.findMany({
        where: { schoolId: actor.schoolId, status: { in: ["pending", "awaiting_parent"] } },
        select: LIST_SELECT,
        orderBy: { leaveAt: "asc" },
      }),
      tx.leaveout.findMany({
        where: { schoolId: actor.schoolId, status: "out" },
        select: LIST_SELECT,
        orderBy: { returnAt: "asc" },
      }),
      tx.leaveout.findMany({
        where: {
          schoolId: actor.schoolId,
          status: "approved",
          leaveAt: { lt: new Date(now.getTime() + 2 * 86_400_000) },
          returnAt: { gt: dayStart },
        },
        select: LIST_SELECT,
        orderBy: { leaveAt: "asc" },
      }),
    ]);
    const names = await staffNames(
      tx,
      actor.schoolId,
      [...waiting, ...out, ...today].flatMap((l) => [l.requestedById, l.decidedById]),
    );
    const withNames = <T extends { requestedById: string; decidedById: string | null }>(l: T) => ({
      ...l,
      requestedBy: names.get(l.requestedById) ?? (l.requestedById ? "Parent" : null),
      approvedBy: l.decidedById ? (names.get(l.decidedById) ?? null) : null,
    });
    return {
      waiting: waiting.map(withNames),
      out: out.map((l) => ({ ...withNames(l), overdue: l.returnAt < now })),
      upcoming: today.map(withNames),
    };
  });
}

export async function getLeaveout({ db }: Deps, actor: Actor, leaveoutId: string) {
  if (!canSeeLeaveouts(actor.permissions) && !actor.permissions.has("gate.scan"))
    throw new ForbiddenError("leaveout.request");
  if (!/^[0-9a-f-]{36}$/i.test(leaveoutId)) return null;
  return withContext(db, ctxOf(actor), async (tx) => {
    const l = await tx.leaveout.findUnique({
      where: { schoolId: actor.schoolId, id: leaveoutId },
      include: { events: { orderBy: { recordedAt: "asc" } } },
    });
    if (!l) return null;
    const names = await staffNames(tx, actor.schoolId, [
      l.requestedById,
      l.decidedById,
      l.cancelledById,
      l.exitById,
      l.returnById,
      ...l.events.map((e) => e.byId),
    ]);
    const who = (id: string | null) => (id ? (names.get(id) ?? "Parent") : null);
    const school = await tx.school.findUniqueOrThrow({
      where: { id: actor.schoolId },
      select: { name: true, logoUrl: true, id: true },
    });
    return {
      ...l,
      school,
      requestedBy: who(l.requestedById),
      approvedBy: who(l.decidedById),
      cancelledBy: who(l.cancelledById),
      exitBy: who(l.exitById),
      returnBy: who(l.returnById),
      events: l.events.map((e) => ({ ...e, by: who(e.byId) })),
    };
  });
}

/** A student's leave-outs (staff profile, newest first). */
export async function studentLeaveouts({ db }: Deps, actor: Actor, studentId: string) {
  if (!canSeeLeaveouts(actor.permissions)) throw new ForbiddenError("leaveout.request");
  return withContext(db, ctxOf(actor), (tx) =>
    tx.leaveout.findMany({
      where: { schoolId: actor.schoolId, studentId },
      select: LIST_SELECT,
      orderBy: { leaveAt: "desc" },
      take: 50,
    }),
  );
}

/** Leave-outs per class and reason, late returns, and who approved, over a period. */
export async function leaveoutReports(
  { db }: Deps,
  actor: Actor,
  from: Date,
  to: Date,
  now = new Date(),
) {
  if (!canManageBoarding(actor.permissions)) throw new ForbiddenError("boarding.manage");
  return withContext(db, ctxOf(actor), async (tx) => {
    const rows = await tx.leaveout.findMany({
      where: {
        schoolId: actor.schoolId,
        leaveAt: { gte: from, lt: to },
        status: { in: ["approved", "out", "returned"] },
      },
      select: { ...LIST_SELECT, decidedById: true },
    });
    const byClass = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const cls = r.classLabel.replace(/\s+\S+$/, "") || r.classLabel; // "Grade 7 East" -> "Grade 7"
      const m = byClass.get(cls) ?? new Map<string, number>();
      m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
      byClass.set(cls, m);
    }
    const late = rows.filter(
      (r) =>
        (r.returnedAt && r.returnedAt > r.returnAt) || (r.status === "out" && r.returnAt < now),
    );
    const names = await staffNames(
      tx,
      actor.schoolId,
      rows.map((r) => r.decidedById),
    );
    const byApprover = new Map<string, number>();
    for (const r of rows) {
      const who = r.decidedById ? (names.get(r.decidedById) ?? "Unknown") : "Unknown";
      byApprover.set(who, (byApprover.get(who) ?? 0) + 1);
    }
    const reasons = [...new Set(rows.map((r) => r.reason))].sort();
    return {
      total: rows.length,
      reasons,
      byClass: [...byClass.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cls, m]) => ({
          cls,
          counts: reasons.map((x) => m.get(x) ?? 0),
          total: [...m.values()].reduce((a, b) => a + b, 0),
        })),
      late: late.map((r) => ({
        ...r,
        lateMinutes: Math.round(((r.returnedAt ?? now).getTime() - r.returnAt.getTime()) / 60_000),
      })),
      byApprover: [...byApprover.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    };
  });
}

// ---------------------------------------------------------------------------
// Not back on time
// ---------------------------------------------------------------------------

/**
 * For every student still out after their return time (once each): an alert to the boarding
 * master and the Director (in the app), and an SMS reminder to the parents. Run by the worker.
 */
export async function checkOverdueLeaveouts(db: PrismaClient, now = new Date()) {
  const schools = await db.$queryRaw<{ id: string }[]>`
    SELECT app_due_overdue_leaveout_schools AS id FROM app_due_overdue_leaveout_schools(${now}::timestamptz)`;
  let alerted = 0;
  for (const { id: schoolId } of schools) {
    const actor = await messagingActor(db, schoolId);
    const late = await withContext(db, { userId: actor.userId, schoolId }, async (tx) => {
      const rows = await tx.leaveout.findMany({
        where: { schoolId, status: "out", returnAt: { lt: now }, overdueAlertedAt: null },
      });
      for (const l of rows) {
        const claimed = await tx.leaveout.updateMany({
          where: { schoolId, id: l.id, overdueAlertedAt: null },
          data: { overdueAlertedAt: now },
        });
        if (!claimed.count) continue;
        await notifyStaffWith(tx, schoolId, ["boarding.manage", "leaveout.approve"], {
          title: "Not back on time",
          body: `${l.studentName} (${l.classLabel}) was due back at ${whenText(l.returnAt)} with ${l.collectorName}.`,
          link: `/dashboard/leaveouts/${l.id}`,
        });
        await audit(tx, {
          schoolId,
          actorId: actor.userId,
          action: "leaveout.overdue",
          targetType: "leaveout",
          targetId: l.id,
          after: { returnAt: l.returnAt },
        });
      }
      return rows;
    });
    for (const l of late) {
      await sendLeaveoutSms(
        db,
        l,
        "leaveout_overdue",
        "parents",
        () => ({ time: leaveoutVars.time(l.returnAt) }),
        { now },
      );
      alerted++;
    }
  }
  return alerted;
}
