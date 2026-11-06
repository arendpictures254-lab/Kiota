/**
 * Leave-outs in the parent portal: history and passes, a new request ("I will collect Amani on
 * Friday at 2pm"), approving another collector, and cancelling. Everything goes through the
 * app_parent_* database functions, from the parent's own link, and only for schools with the
 * boarding module switched on and guardians who receive boarding messages.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedDb, withContext } from "@/lib/db-core";
import { sha256 } from "@/lib/crypto";
import { normalizePhone } from "@/lib/phone";
import { ValidationError, clean } from "@/lib/service-kit";
import { nairobiInput } from "./rules";
import { collectorApproved, parentCancelled } from "./service";
import { notifyStaffWith } from "./notify";
import { messagingActor } from "@/lib/messaging/system";
import { whenText } from "./rules";

type Deps = { db: PrismaClient };
const ctx = (userId: string) => ({ userId, schoolId: null });

export type ParentLeaveout = {
  id: string;
  status: string;
  reason: string;
  details: string | null;
  leaveAt: Date;
  returnAt: Date;
  collectorName: string;
  collectorRelationship: string;
  collectorKind: string;
  passToken: string | null;
  exitedAt: Date | null;
  returnedAt: Date | null;
  declineReason: string | null;
  requestedVia: string;
  studentName: string;
  admissionNumber: string;
  classLabel: string;
};

export async function parentLeaveouts(
  { db }: Deps,
  userId: string,
  linkId: string,
): Promise<ParentLeaveout[]> {
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) return [];
  const rows = await scopedDb(db, ctx(userId)).$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM app_parent_leaveouts(${linkId}::uuid)`;
  return rows.map((r) => ({
    id: String(r.id),
    status: String(r.status),
    reason: String(r.reason),
    details: (r.details as string | null) ?? null,
    leaveAt: new Date(r.leave_at as string),
    returnAt: new Date(r.return_at as string),
    collectorName: String(r.collector_name),
    collectorRelationship: String(r.collector_relationship),
    collectorKind: String(r.collector_kind),
    passToken: (r.pass_token as string | null) ?? null,
    exitedAt: r.exited_at ? new Date(r.exited_at as string) : null,
    returnedAt: r.returned_at ? new Date(r.returned_at as string) : null,
    declineReason: (r.decline_reason as string | null) ?? null,
    requestedVia: String(r.requested_via),
    studentName: String(r.student_name),
    admissionNumber: String(r.admission_number),
    classLabel: String(r.class_label),
  }));
}

export async function parentCollectors({ db }: Deps, userId: string, linkId: string) {
  return scopedDb(db, ctx(userId)).$queryRaw<
    { link_id: string; name: string; relationship: string }[]
  >`
    SELECT * FROM app_parent_collectors(${linkId}::uuid)`;
}

export async function parentReasons({ db }: Deps, userId: string, linkId: string) {
  return scopedDb(db, ctx(userId)).$queryRaw<{ id: string; name: string }[]>`
    SELECT * FROM app_leaveout_reasons_for_parent(${linkId}::uuid)`;
}

export type ParentRequestError =
  "reason" | "leaveAt" | "returnAt" | "collector" | "other" | "not_allowed";

export class ParentLeaveoutError extends ValidationError {}

/** The parent asks for a leave-out; approvers are told. */
export async function parentRequestLeaveout(
  deps: Deps,
  userId: string,
  linkId: string,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  const reasonId = clean(raw.reasonId);
  if (!reasonId) throw new ParentLeaveoutError("reason", "reasonId");
  const leaveAt = nairobiInput(String(raw.leaveAt ?? ""));
  if (!leaveAt || leaveAt.getTime() < now.getTime() - 3600_000)
    throw new ParentLeaveoutError("leaveAt", "leaveAt");
  const returnAt = nairobiInput(String(raw.returnAt ?? ""));
  if (!returnAt || returnAt <= leaveAt) throw new ParentLeaveoutError("returnAt", "returnAt");
  const pick = clean(raw.collector);
  let linkCollector: string | null = null;
  let other: { name: string; phone: string; relationship: string } | null = null;
  if (pick?.startsWith("link:")) linkCollector = pick.slice(5);
  else if (pick === "other") {
    const name = clean(raw.otherName);
    const phone = normalizePhone(String(raw.otherPhone ?? ""));
    const relationship = clean(raw.otherRelationship);
    if (!name || !phone || !phone.startsWith("+254") || !relationship)
      throw new ParentLeaveoutError("other", "otherName");
    other = { name: name.slice(0, 80), phone, relationship: relationship.slice(0, 40) };
  } else throw new ParentLeaveoutError("collector", "collector");

  let id: string;
  try {
    [{ id }] = await withContext(
      deps.db,
      ctx(userId),
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
        SELECT app_parent_request_leaveout(${linkId}::uuid, ${reasonId}::uuid, ${clean(raw.details)},
          ${leaveAt}::timestamptz, ${returnAt}::timestamptz, ${linkCollector}::uuid,
          ${other?.name ?? null}, ${other?.phone ?? null}, ${other?.relationship ?? null}) AS id`,
    );
  } catch (err) {
    const m = String(err);
    if (/collector not authorised|bad collector/.test(m))
      throw new ParentLeaveoutError("collector", "collector");
    if (/bad reason/.test(m)) throw new ParentLeaveoutError("reason", "reasonId");
    if (/bad dates/.test(m)) throw new ParentLeaveoutError("leaveAt", "leaveAt");
    if (/not allowed/.test(m)) throw new ParentLeaveoutError("not_allowed");
    throw err;
  }
  // Tell the school's approvers (as the school's automatic member: the parent has no school context).
  const schoolId = await schoolOfLink(deps.db, userId, linkId);
  if (schoolId) {
    // (Skipped if the school has never sent a message: approvers still see it in their queue.)
    const sys = await messagingActor(deps.db, schoolId).catch(() => null);
    if (!sys) return id;
    await withContext(deps.db, { userId: sys.userId, schoolId }, async (tx) => {
      const l = await tx.leaveout.findUnique({ where: { schoolId, id } });
      if (!l) return;
      await notifyStaffWith(tx, schoolId, ["leaveout.approve"], {
        title: "Leave-out to approve (from a parent)",
        body: `${l.studentName} (${l.classLabel}): ${l.reason}, ${whenText(l.leaveAt)}. Collector: ${l.collectorName}.`,
        link: `/dashboard/leaveouts/${l.id}`,
      });
    });
  }
  return id;
}

async function schoolOfLink(db: PrismaClient, userId: string, linkId: string) {
  const [row] = await scopedDb(db, ctx(userId)).$queryRaw<{ school_id: string | null }[]>`
    SELECT school_id FROM app_my_children() WHERE link_id = ${linkId}::uuid`;
  return row?.school_id ?? null;
}

/** The parent approves or refuses another collector a staff member named. */
export async function parentAnswerCollector(
  deps: Deps,
  userId: string,
  leaveoutId: string,
  yes: boolean,
) {
  if (!/^[0-9a-f-]{36}$/i.test(leaveoutId)) return false;
  const [row] = await withContext(
    deps.db,
    ctx(userId),
    (tx) =>
      tx.$queryRaw<{ school_id: string | null }[]>`
      SELECT app_parent_answer_collector(${leaveoutId}::uuid, ${yes}) AS school_id`,
  );
  if (!row?.school_id) return false;
  await collectorApproved(deps.db, row.school_id, leaveoutId);
  return true;
}

/**
 * An SMS reply from a parent: "YES 1234", "NO 1234" (or NDIYO / HAPANA). Switched off: the SMS
 * now carries a "Tap to approve" link, because an alphanumeric sender ID cannot receive replies.
 * The webhook only calls this with SMS_REPLIES=on (a two-way number from Africa's Talking).
 */
export async function smsCollectorReply(db: PrismaClient, fromPhone: string, text: string) {
  const m = /^\s*(YES|NDIYO|NO|HAPANA)\W*(\d{4})\s*$/i.exec(text);
  const phone = normalizePhone(fromPhone);
  if (!m || !phone) return null;
  const yes = /^(YES|NDIYO)$/i.test(m[1]);
  const [row] = await db.$queryRaw<{ school_id: string; leaveout_id: string }[]>`
    SELECT * FROM app_sms_collector_reply(${phone}, ${m[2]}, ${yes})`;
  if (!row) return null;
  await collectorApproved(db, row.school_id, row.leaveout_id);
  return { leaveoutId: row.leaveout_id, yes };
}

export async function parentCancelLeaveout({ db }: Deps, userId: string, leaveoutId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(leaveoutId)) return false;
  const [row] = await withContext(
    db,
    ctx(userId),
    (tx) =>
      tx.$queryRaw<
        { school_id: string | null }[]
      >`SELECT app_parent_cancel_leaveout(${leaveoutId}::uuid) AS school_id`,
  );
  if (!row?.school_id) return false;
  await parentCancelled(db, row.school_id, leaveoutId).catch((err) =>
    console.error("[leaveouts] cancellation SMS failed", err),
  );
  return true;
}

/** The parent opened a "Tap to approve" link: the leave-out and their own link to the child. */
export async function collectorLinkTarget({ db }: Deps, userId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await scopedDb(db, ctx(userId)).$queryRaw<
    { link_id: string; leaveout_id: string }[]
  >`SELECT * FROM app_parent_collector_link(${sha256(token)})`;
  return row ? { linkId: row.link_id, leaveoutId: row.leaveout_id } : null;
}
