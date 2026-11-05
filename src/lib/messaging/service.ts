/**
 * What gets sent, and who may send it. Every function checks permissions itself, runs in the
 * school's row-level-security context, and queues messages with their cost reserved
 * (outbox.ts). Nothing here waits for a provider: the worker sends in the background.
 *
 *  - Payment received (automatic, from postPayment): SMS with amount, new balance and the
 *    receipt link; the receipt PDF on WhatsApp too when the guardian has it.
 *  - Fee reminders (messages.send or messages.send.fees): from the defaulters list.
 *  - Notices (messages.send): to the whole school, a level, class or stream, boarders or day
 *    scholars.
 * Bulk sends are previewed first (recipients, units, cost, balance after) and refused if the
 * cost changed since the preview.
 */
import { audit } from "@/lib/audit";
import type { PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { firstMissedDueDate, kes, receiptNo } from "@/lib/fees/allocation";
import { APP_URL } from "@/lib/hosts";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { inQuietHours } from "./quiet-hours";
import {
  type Category,
  type CostSummary,
  type Draft,
  guardianRecipients,
  onePerPhone,
  planDrafts,
  queuePlanned,
  summarise,
} from "./outbox";

export const MAX_NOTICE_CHARS = 612; // four SMS units

type Perms = ReadonlySet<PermissionKey>;

export const canSendNotices = (p: Perms) => p.has("messages.send");
export const canSendFeeReminders = (p: Perms) =>
  p.has("messages.send") || p.has("messages.send.fees");
/** Who may open the message log. Row-level security decides which messages they see. */
export const canSeeMessages = (p: Perms) =>
  p.has("messages.view_all") ||
  canSendFeeReminders(p) ||
  p.has("wallet.topup") ||
  p.has("students.view.own_streams");

/** Links in SMS without "https://" (phones still make them clickable, and it saves 8 characters). */
const shortLink = (path: string) => `${APP_URL.replace(/^https?:\/\//, "")}${path}`;

/** "Amina W." — first name and initial, like the public receipt. */
const shortName = (s: { firstName: string; lastName: string }) =>
  `${s.firstName} ${s.lastName.slice(0, 1)}.`;

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

async function schoolName(tx: Tx, schoolId: string) {
  const s = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
  return s.name;
}

export type SendPreview = CostSummary & {
  balanceCents: number;
  balanceAfterCents: number;
  enough: boolean;
  /** Not critical and it is quiet hours: the messages wait for 07:00. */
  waitsForMorning: boolean;
  sample: string | null;
};

function preview(
  summary: CostSummary,
  balanceCents: number,
  overdraftCents: number,
  critical: boolean,
  sample: string | null,
  now: Date,
): SendPreview {
  const after = balanceCents - summary.costCents;
  return {
    ...summary,
    balanceCents,
    balanceAfterCents: after,
    enough: after >= (critical ? -overdraftCents : 0),
    waitsForMorning: !critical && inQuietHours(now),
    sample,
  };
}

export class CostChangedError extends ValidationError {
  constructor(public readonly preview: SendPreview) {
    super(
      `The cost changed to ${kes(preview.costCents)} since you checked. Check the numbers and send again.`,
    );
    this.name = "CostChangedError";
  }
}

// ---------------------------------------------------------------------------
// Payment received (automatic)
// ---------------------------------------------------------------------------

/**
 * Queue the payment confirmation to the student's fee contacts. Runs inside the payment's own
 * transaction, as whoever recorded it (a Bursar, a clerk or the automatic M-Pesa member).
 * Never throws for an empty wallet: those messages are recorded as not sent.
 */
export async function queuePaymentMessages(
  tx: Tx,
  actor: Actor,
  p: {
    studentId: string;
    amountCents: number;
    balanceAfterCents: number;
    receiptNumber: number;
    shareToken: string;
    now?: Date;
  },
) {
  const recipients = await guardianRecipients(
    tx,
    { schoolId: actor.schoolId, studentIds: [p.studentId] },
    "fees",
  );
  if (recipients.length === 0) return { queued: 0, notSent: 0, costCents: 0 };
  const [school, student] = await Promise.all([
    schoolName(tx, actor.schoolId),
    tx.student.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: p.studentId },
      select: { firstName: true, lastName: true, admissionNumber: true },
    }),
  ]);
  const vars = {
    school,
    amount: kes(p.amountCents).replace(/^KES /, ""),
    student: shortName(student),
    admission: student.admissionNumber,
    balance: kes(Math.max(0, p.balanceAfterCents)),
    credit: p.balanceAfterCents < 0 ? kes(-p.balanceAfterCents) : null,
    receipt_no: receiptNo(p.receiptNumber),
    link: shortLink(`/r/${p.shareToken}`),
  };
  const drafts: Draft[] = [];
  for (const r of recipients) {
    drafts.push({ recipient: r, templateKey: "payment_received", channel: "sms", vars });
    if (r.whatsapp) {
      // The receipt itself on WhatsApp, as well as the SMS.
      drafts.push({
        recipient: r,
        templateKey: "payment_received",
        channel: "whatsapp",
        vars,
        fallbackToSms: false,
        document: {
          url: `${APP_URL}/r/${p.shareToken}/pdf`,
          filename: `receipt-${receiptNo(p.receiptNumber)}.pdf`,
        },
      });
    }
  }
  const { planned } = await planDrafts(tx, actor.schoolId, drafts);
  return queuePlanned(tx, {
    schoolId: actor.schoolId,
    planned,
    mode: "each",
    now: p.now,
    createdById: actor.userId,
  });
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export type NoticeInput = {
  audience: string;
  topic: Category;
  channel: "sms" | "whatsapp";
  critical: boolean;
  message: string;
  messageSw: string | null;
};

export const TOPICS: { value: Category; label: string }[] = [
  { value: "general", label: "General (all parents except fee-only contacts)" },
  { value: "academics", label: "Academics" },
  { value: "boarding", label: "Boarding" },
  { value: "fees", label: "Fees" },
];

export function parseNoticeInput(raw: Record<string, unknown>): NoticeInput {
  const message = clean(raw.message);
  if (!message) throw new ValidationError("Write the message.", "message");
  if (message.length > MAX_NOTICE_CHARS)
    throw new ValidationError(
      `Keep the message under ${MAX_NOTICE_CHARS} characters (four SMS).`,
      "message",
    );
  const messageSw = clean(raw.messageSw);
  if (messageSw && messageSw.length > MAX_NOTICE_CHARS)
    throw new ValidationError(
      `Keep the Kiswahili message under ${MAX_NOTICE_CHARS} characters.`,
      "messageSw",
    );
  const topic = TOPICS.find((t) => t.value === raw.topic)?.value ?? "general";
  const audience = clean(raw.audience);
  if (!audience) throw new ValidationError("Choose who to send it to.", "audience");
  return {
    audience,
    topic,
    channel: raw.channel === "whatsapp" ? "whatsapp" : "sms",
    critical: raw.critical === "on" || raw.critical === "true" || raw.critical === true,
    message,
    messageSw,
  };
}

/** "school", "boarders", "day", "level:<id>", "class:<id>" or "stream:<id>". */
async function resolveAudience(tx: Tx, schoolId: string, audience: string) {
  const [kind, id] = audience.split(":");
  switch (kind) {
    case "school":
      return { where: {}, label: "Whole school" };
    case "boarders":
      return { where: { boarder: true }, label: "Boarders" };
    case "day":
      return { where: { boarder: false }, label: "Day scholars" };
    case "level": {
      const l = id ? await tx.level.findFirst({ where: { id, schoolId } }) : null;
      if (!l) break;
      return { where: { class: { levelId: l.id } }, label: l.name };
    }
    case "class": {
      const c = id ? await tx.class.findFirst({ where: { id, schoolId } }) : null;
      if (!c) break;
      return { where: { classId: c.id }, label: c.name };
    }
    case "stream": {
      const s = id
        ? await tx.stream.findFirst({ where: { id, schoolId }, include: { class: true } })
        : null;
      if (!s) break;
      return { where: { streamId: s.id }, label: `${s.class.name} ${s.name}` };
    }
  }
  throw new ValidationError("Choose who to send it to.", "audience");
}

async function planNotice(tx: Tx, actor: Actor, input: NoticeInput) {
  const target = await resolveAudience(tx, actor.schoolId, input.audience);
  const recipients = onePerPhone(
    await guardianRecipients(tx, { schoolId: actor.schoolId, students: target.where }, input.topic),
  );
  const school = await schoolName(tx, actor.schoolId);
  const drafts: Draft[] = recipients.map((r) => ({
    recipient: r,
    templateKey: "notice",
    channel: input.channel,
    critical: input.critical,
    vars: {
      school,
      message: r.language === "sw" && input.messageSw ? input.messageSw : input.message,
    },
  }));
  const plan = await planDrafts(tx, actor.schoolId, drafts);
  return { ...plan, target };
}

export async function previewNotice(
  { db }: Deps,
  actor: Actor,
  input: NoticeInput,
  now = new Date(),
): Promise<SendPreview & { audienceLabel: string }> {
  assertCan(actor.permissions, "messages.send");
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, target } = await planNotice(tx, actor, input);
    return {
      ...preview(
        summarise(planned),
        balanceCents,
        wallet.overdraftLimitCents,
        input.critical,
        planned[0]?.body ?? null,
        now,
      ),
      audienceLabel: target.label,
    };
  });
}

/** Send a notice. `expectedCostCents` is the cost the person saw; a different cost is refused. */
export async function sendNotice(
  { db }: Deps,
  actor: Actor,
  input: NoticeInput,
  expectedCostCents: number | null,
  now = new Date(),
) {
  assertCan(actor.permissions, "messages.send");
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, target } = await planNotice(tx, actor, input);
    const summary = summarise(planned);
    if (summary.recipients === 0)
      throw new ValidationError("No parents to send to: nobody in this group has a contact.");
    if (expectedCostCents !== null && expectedCostCents !== summary.costCents) {
      throw new CostChangedError(
        preview(
          summary,
          balanceCents,
          wallet.overdraftLimitCents,
          input.critical,
          planned[0]?.body ?? null,
          now,
        ),
      );
    }
    const campaign = await tx.messageCampaign.create({
      data: {
        schoolId: actor.schoolId,
        kind: "notice",
        title: input.message.slice(0, 60),
        body: input.message,
        bodySw: input.messageSw,
        audience: { value: input.audience, label: target.label, topic: input.topic },
        channel: input.channel,
        category: input.topic,
        critical: input.critical,
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
        createdById: actor.userId,
      },
    });
    const result = await queuePlanned(tx, {
      schoolId: actor.schoolId,
      planned,
      mode: "all",
      now,
      createdById: actor.userId,
      campaignId: campaign.id,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "messages.notice",
      targetType: "message_campaign",
      targetId: campaign.id,
      after: {
        audience: target.label,
        topic: input.topic,
        channel: input.channel,
        critical: input.critical,
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
      },
      ip: actor.ip,
    });
    return { campaignId: campaign.id, ...result, recipients: summary.recipients };
  });
}

// ---------------------------------------------------------------------------
// Fee reminders
// ---------------------------------------------------------------------------

function assertCanRemind(actor: Actor) {
  if (!canSendFeeReminders(actor.permissions)) throw new ForbiddenError("messages.send.fees");
}

async function planReminders(tx: Tx, actor: Actor, studentIds: string[], now: Date) {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) throw new ValidationError("Choose at least one student.");
  const [balances, students, invoices, school, mpesa] = await Promise.all([
    tx.$queryRaw<{ student_id: string; balance: bigint }[]>`
      SELECT student_id, sum(amount_cents) AS balance FROM ledger_lines
      WHERE school_id = ${actor.schoolId}::uuid AND student_id = ANY(${ids}::uuid[])
      GROUP BY student_id`,
    tx.student.findMany({
      where: { schoolId: actor.schoolId, id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    }),
    tx.invoice.findMany({
      where: { schoolId: actor.schoolId, studentId: { in: ids } },
      orderBy: { createdAt: "desc" },
    }),
    schoolName(tx, actor.schoolId),
    // Readable only to fee staff (row-level security); without it the Paybill line is left out.
    tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } }).catch(() => null),
  ]);
  const structures = await tx.feeStructure.findMany({
    where: {
      schoolId: actor.schoolId,
      id: { in: [...new Set(invoices.map((i) => i.feeStructureId))] },
    },
    include: { installments: true },
  });
  const owing = students.filter(
    (s) => Number(balances.find((b) => b.student_id === s.id)?.balance ?? 0) > 0,
  );
  const recipients = await guardianRecipients(
    tx,
    { schoolId: actor.schoolId, studentIds: owing.map((s) => s.id) },
    "fees",
  );
  const drafts: Draft[] = recipients.map((r) => {
    const s = owing.find((x) => x.id === r.studentId)!;
    const balance = Number(balances.find((b) => b.student_id === s.id)!.balance);
    const invoice = invoices.find((i) => i.studentId === s.id);
    const plan = structures.find((f) => f.id === invoice?.feeStructureId)?.installments ?? [];
    let due: Date | null = null;
    if (invoice && plan.length) {
      const paidToward = invoice.totalCents - Math.min(balance, invoice.totalCents);
      due =
        firstMissedDueDate(invoice.totalCents, paidToward, plan, now) ??
        plan
          .map((i) => i.dueDate)
          .filter((d) => d > now)
          .sort((a, b) => a.getTime() - b.getTime())[0] ??
        null;
    }
    return {
      recipient: r,
      templateKey: "fee_reminder",
      channel: "sms",
      vars: {
        school,
        student: shortName(s),
        admission: s.admissionNumber,
        balance: kes(balance),
        due_date: due ? day(due) : null,
        paybill: mpesa?.shortcodeType === "paybill" ? mpesa.shortcode : null,
      },
    };
  });
  return {
    ...(await planDrafts(tx, actor.schoolId, drafts)),
    students: owing.length,
    noContact: owing.filter((s) => !recipients.some((r) => r.studentId === s.id)).length,
  };
}

export async function previewFeeReminders(
  { db }: Deps,
  actor: Actor,
  studentIds: string[],
  now = new Date(),
) {
  assertCanRemind(actor);
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, students, noContact } = await planReminders(
      tx,
      actor,
      studentIds,
      now,
    );
    return {
      ...preview(
        summarise(planned),
        balanceCents,
        wallet.overdraftLimitCents,
        false,
        planned[0]?.body ?? null,
        now,
      ),
      students,
      noContact,
    };
  });
}

export async function sendFeeReminders(
  { db }: Deps,
  actor: Actor,
  studentIds: string[],
  expectedCostCents: number | null,
  now = new Date(),
) {
  assertCanRemind(actor);
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, students } = await planReminders(
      tx,
      actor,
      studentIds,
      now,
    );
    const summary = summarise(planned);
    if (summary.recipients === 0)
      throw new ValidationError(
        "None of these students has a fee contact with a balance to remind.",
      );
    if (expectedCostCents !== null && expectedCostCents !== summary.costCents) {
      throw new CostChangedError(
        preview(
          summary,
          balanceCents,
          wallet.overdraftLimitCents,
          false,
          planned[0]?.body ?? null,
          now,
        ),
      );
    }
    const campaign = await tx.messageCampaign.create({
      data: {
        schoolId: actor.schoolId,
        kind: "fee_reminder",
        title: `Fee reminders (${students} student${students === 1 ? "" : "s"})`,
        audience: { studentIds: [...new Set(studentIds)] },
        channel: "sms",
        category: "fees",
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
        createdById: actor.userId,
      },
    });
    const result = await queuePlanned(tx, {
      schoolId: actor.schoolId,
      planned,
      mode: "all",
      now,
      createdById: actor.userId,
      campaignId: campaign.id,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "messages.fee_reminder",
      targetType: "message_campaign",
      targetId: campaign.id,
      after: {
        students,
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
      },
      ip: actor.ip,
    });
    return { campaignId: campaign.id, ...result, students, recipients: summary.recipients };
  });
}

// ---------------------------------------------------------------------------
// Inviting parents to the portal
// ---------------------------------------------------------------------------

export type InviteInput = { audience: string; onlyNew: boolean };

export function parseInviteInput(raw: Record<string, unknown>): InviteInput {
  const audience = clean(raw.audience);
  if (!audience) throw new ValidationError("Choose who to invite.", "audience");
  return {
    audience,
    onlyNew: raw.onlyNew === "on" || raw.onlyNew === "true" || raw.onlyNew === true,
  };
}

async function planInvite(tx: Tx, actor: Actor, input: InviteInput) {
  const target = await resolveAudience(tx, actor.schoolId, input.audience);
  const recipients = onePerPhone(
    await guardianRecipients(
      tx,
      { schoolId: actor.schoolId, students: target.where, notSignedIn: input.onlyNew },
      "account",
    ),
  );
  const school = await schoolName(tx, actor.schoolId);
  const drafts: Draft[] = recipients.map((r) => ({
    recipient: r,
    templateKey: "parent_invite",
    channel: "sms",
    vars: { school, link: shortLink("") },
  }));
  const plan = await planDrafts(tx, actor.schoolId, drafts);
  return { ...plan, target };
}

export async function previewInvite(
  { db }: Deps,
  actor: Actor,
  input: InviteInput,
  now = new Date(),
) {
  assertCan(actor.permissions, "messages.send");
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, target } = await planInvite(tx, actor, input);
    return {
      ...preview(
        summarise(planned),
        balanceCents,
        wallet.overdraftLimitCents,
        false,
        planned[0]?.body ?? null,
        now,
      ),
      audienceLabel: target.label,
    };
  });
}

/** Send the invitation. `expectedCostCents` is the cost the person saw; a different one is refused. */
export async function sendInvite(
  { db }: Deps,
  actor: Actor,
  input: InviteInput,
  expectedCostCents: number | null,
  now = new Date(),
) {
  assertCan(actor.permissions, "messages.send");
  return withContext(db, ctxOf(actor), async (tx) => {
    const { planned, wallet, balanceCents, target } = await planInvite(tx, actor, input);
    const summary = summarise(planned);
    if (summary.recipients === 0)
      throw new ValidationError(
        "Nobody to invite: every parent in this group has signed in already, or has no phone.",
      );
    if (expectedCostCents !== null && expectedCostCents !== summary.costCents) {
      throw new CostChangedError(
        preview(
          summary,
          balanceCents,
          wallet.overdraftLimitCents,
          false,
          planned[0]?.body ?? null,
          now,
        ),
      );
    }
    const campaign = await tx.messageCampaign.create({
      data: {
        schoolId: actor.schoolId,
        kind: "invite",
        title: `Portal invitation: ${target.label}`,
        audience: { value: input.audience, label: target.label, onlyNew: input.onlyNew },
        channel: "sms",
        category: "account",
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
        createdById: actor.userId,
      },
    });
    const result = await queuePlanned(tx, {
      schoolId: actor.schoolId,
      planned,
      mode: "all",
      now,
      createdById: actor.userId,
      campaignId: campaign.id,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "messages.invite",
      targetType: "message_campaign",
      targetId: campaign.id,
      after: {
        audience: target.label,
        onlyNew: input.onlyNew,
        recipients: summary.recipients,
        units: summary.units,
        costCents: summary.costCents,
      },
      ip: actor.ip,
    });
    return { campaignId: campaign.id, ...result, recipients: summary.recipients };
  });
}

/** Who has signed in to the parent portal at least once, so the school can follow up. */
export async function portalSignIns({ db }: Deps, actor: Actor, audience = "school") {
  assertCan(actor.permissions, "messages.send");
  return withContext(db, ctxOf(actor), async (tx) => {
    const target = await resolveAudience(tx, actor.schoolId, audience);
    const links = await tx.guardianLink.findMany({
      where: { schoolId: actor.schoolId, student: { status: "active", ...target.where } },
      select: {
        id: true,
        name: true,
        portalFirstSeenAt: true,
        user: { select: { phone: true } },
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { name: true } },
            stream: { select: { name: true } },
          },
        },
      },
      orderBy: [{ portalFirstSeenAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    });
    // One row per parent (by phone): a parent of two children signs in once.
    const byPhone = new Map<string, (typeof links)[number] & { children: string[] }>();
    for (const l of links) {
      const label = `${l.student.firstName} ${l.student.lastName} (${l.student.class.name}${l.student.stream ? ` ${l.student.stream.name}` : ""})`;
      const seen = byPhone.get(l.user.phone);
      if (seen) {
        seen.children.push(label);
        if (
          l.portalFirstSeenAt &&
          (!seen.portalFirstSeenAt || l.portalFirstSeenAt < seen.portalFirstSeenAt)
        )
          seen.portalFirstSeenAt = l.portalFirstSeenAt;
      } else byPhone.set(l.user.phone, { ...l, children: [label] });
    }
    const rows = [...byPhone.values()].map((r) => ({
      linkId: r.id,
      name: r.name,
      phone: r.user.phone,
      children: r.children,
      signedInAt: r.portalFirstSeenAt,
    }));
    return {
      audienceLabel: target.label,
      rows,
      signedIn: rows.filter((r) => r.signedInAt).length,
      total: rows.length,
    };
  });
}

/** How many parents read each notice in the portal (the school's read receipts). */
export async function noticeReadCounts({ db }: Deps, actor: Actor, campaignIds: string[]) {
  if (campaignIds.length === 0) return new Map<string, number>();
  const rows = await withContext(db, ctxOf(actor), (tx) =>
    tx.noticeRead.groupBy({
      by: ["campaignId"],
      where: { schoolId: actor.schoolId, campaignId: { in: campaignIds } },
      _count: { _all: true },
    }),
  );
  return new Map(rows.map((r) => [r.campaignId, r._count._all]));
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type MessageFilters = {
  status?: string;
  studentId?: string;
  guardianLinkId?: string;
  campaignId?: string;
};

const STATUSES = ["queued", "sending", "sent", "delivered", "failed"] as const;

/** The message log. Row-level security: the Director sees all, a class teacher their streams. */
export async function listMessages({ db }: Deps, actor: Actor, f: MessageFilters = {}) {
  if (!canSeeMessages(actor.permissions)) throw new ForbiddenError("messages.view_all");
  return withContext(db, ctxOf(actor), async (tx) => {
    const status = STATUSES.find((s) => s === f.status);
    const messages = await tx.message.findMany({
      where: {
        schoolId: actor.schoolId,
        ...(status ? { status } : {}),
        ...(f.studentId ? { studentId: f.studentId } : {}),
        ...(f.guardianLinkId ? { guardianLinkId: f.guardianLinkId } : {}),
        ...(f.campaignId ? { campaignId: f.campaignId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const [students, links, refunds] = await Promise.all([
      tx.student.findMany({
        where: {
          schoolId: actor.schoolId,
          id: { in: [...new Set(messages.flatMap((m) => (m.studentId ? [m.studentId] : [])))] },
        },
        select: { id: true, firstName: true, lastName: true, admissionNumber: true },
      }),
      tx.guardianLink.findMany({
        where: {
          schoolId: actor.schoolId,
          id: {
            in: [...new Set(messages.flatMap((m) => (m.guardianLinkId ? [m.guardianLinkId] : [])))],
          },
        },
        select: { id: true, name: true },
      }),
      tx.walletEntry.findMany({
        where: {
          schoolId: actor.schoolId,
          messageId: { in: messages.map((m) => m.id) },
          type: { in: ["refund", "adjustment"] },
        },
        select: { messageId: true, amountCents: true },
      }),
    ]);
    return messages.map((m) => {
      const s = students.find((x) => x.id === m.studentId);
      const back = refunds
        .filter((r) => r.messageId === m.id)
        .reduce((n, r) => n + r.amountCents, 0);
      return {
        id: m.id,
        createdAt: m.createdAt,
        channel: m.channel,
        status: m.status,
        to: m.toPhone,
        guardian: links.find((l) => l.id === m.guardianLinkId)?.name ?? null,
        guardianLinkId: m.guardianLinkId,
        student: s
          ? { id: s.id, name: `${s.firstName} ${s.lastName}`, admissionNumber: s.admissionNumber }
          : null,
        body: m.body,
        units: m.units,
        /** What it finally cost: the reserve less any refund. */
        costCents: Math.max(0, m.costCents - back),
        critical: m.critical,
        error: m.error,
        nextAttemptAt: m.nextAttemptAt,
        templateKey: m.templateKey,
        fallback: !!m.fallbackOfId,
      };
    });
  });
}
