/**
 * The sending worker and delivery reports.
 *
 * The messages table is the queue. processDueMessages() finds schools with messages due
 * (app_due_message_schools), then for each school, as its hidden "Automatic messages" member:
 *  1. moves non-critical messages that are due during quiet hours to 07:00;
 *  2. claims due messages (FOR UPDATE SKIP LOCKED, so two workers never send the same one);
 *  3. sends each through the SMS or WhatsApp driver, outside any transaction;
 *  4. records the result: sent; or retry later (network trouble, up to MAX_ATTEMPTS); or failed,
 *     with the reserved cost refunded and, for WhatsApp, the same message queued by SMS;
 *  5. tells the Director and Bursar once when the balance falls below their alert threshold.
 * Delivery reports later move a message to delivered or failed (failed is refunded).
 */
import type { Message, PrismaClient } from "@/generated/prisma/client";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { withContext, type Tx } from "@/lib/db-core";
import { kes } from "@/lib/fees/allocation";
import { sendPlatformSms, sendSms } from "@/lib/sms";
import { getWhatsAppDriver } from "@/lib/whatsapp";
import { type Planned, lockWallet, planDrafts, queuePlanned, walletBalance } from "./outbox";
import { inQuietHours, nextSendTime } from "./quiet-hours";
import { messagingActor } from "./system";
import { whatsappParams, type TemplateVars } from "./templates";

export const MAX_ATTEMPTS = 5;
const BATCH = 50;
const PARALLEL = 5;
const STUCK_MS = 10 * 60_000;

const SYSTEM_ROLES = BUILT_IN_ROLES.filter((r) => r.hidden).map((r) => r.key);

/** 30 s, 1 min, 2 min, 4 min... */
const backoffMs = (attempts: number) => 30_000 * 2 ** Math.max(0, attempts - 1);

export type ProcessResult = { sent: number; retrying: number; failed: number };

export async function processDueMessages(
  db: PrismaClient,
  opts: { now?: Date } = {},
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const schools = await db.$queryRaw<{ id: string }[]>`
    SELECT app_due_message_schools AS id FROM app_due_message_schools(${now}::timestamptz)`;
  const total: ProcessResult = { sent: 0, retrying: 0, failed: 0 };
  for (const { id } of schools) {
    const r = await processSchool(db, id, now);
    total.sent += r.sent;
    total.retrying += r.retrying;
    total.failed += r.failed;
  }
  return total;
}

async function processSchool(
  db: PrismaClient,
  schoolId: string,
  now: Date,
): Promise<ProcessResult> {
  const actor = await messagingActor(db, schoolId);
  const ctx = { userId: actor.userId, schoolId };
  const claimed = await withContext(db, ctx, async (tx) => {
    // A worker that died mid-send leaves messages "sending": try them again.
    await tx.message.updateMany({
      where: { status: "sending", lockedAt: { lt: new Date(now.getTime() - STUCK_MS) } },
      data: { status: "queued" },
    });
    if (inQuietHours(now)) {
      await tx.message.updateMany({
        where: { status: "queued", critical: false, nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: nextSendTime(now, false) },
      });
    }
    const ids = await tx.$queryRaw<{ id: string }[]>`
      UPDATE messages SET status = 'sending', attempts = attempts + 1, locked_at = ${now}::timestamptz,
                          updated_at = ${now}::timestamptz
      WHERE id IN (
        SELECT id FROM messages
        WHERE status = 'queued' AND next_attempt_at <= ${now}::timestamptz
        ORDER BY critical DESC, created_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (ids.length === 0) return { messages: [] as Message[], senderId: null as string | null };
    const [messages, wallet] = await Promise.all([
      tx.message.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        orderBy: { createdAt: "asc" },
      }),
      tx.wallet.findUniqueOrThrow({ where: { schoolId } }),
    ]);
    return { messages, senderId: wallet.senderIdApproved ? wallet.senderId : null };
  });

  const result: ProcessResult = { sent: 0, retrying: 0, failed: 0 };
  const queue = [...claimed.messages];
  async function lane() {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const outcome = await sendOne(db, ctx, m, claimed.senderId, now);
      result[outcome]++;
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, lane));
  await checkLowBalance(db, ctx, now);
  return result;
}

type Ctx = { userId: string; schoolId: string };

async function sendOne(
  db: PrismaClient,
  ctx: Ctx,
  m: Message,
  senderId: string | null,
  now: Date,
): Promise<"sent" | "retrying" | "failed"> {
  let r:
    | { ok: true; provider: string; providerMessageId: string; units?: number }
    | { ok: false; provider: string; error: string; retryable: boolean };
  try {
    if (m.channel === "sms") {
      r = await sendSms({ to: m.toPhone, text: m.body, from: senderId });
    } else {
      const wa = getWhatsAppDriver();
      if (!wa) {
        r = {
          ok: false,
          provider: "whatsapp",
          error: "WhatsApp is switched off",
          retryable: false,
        };
      } else {
        const t = await withContext(db, ctx, (tx) =>
          tx.messageTemplate.findUnique({
            where: { key_language: { key: m.templateKey, language: m.language } },
          }),
        );
        if (!t?.whatsappName || t.whatsappStatus !== "approved") {
          r = {
            ok: false,
            provider: wa.name,
            error: "The WhatsApp template is not approved",
            retryable: false,
          };
        } else {
          r = await wa.send({
            to: m.toPhone,
            template: t.whatsappName,
            language: m.language,
            params: whatsappParams(t, (m.params ?? {}) as TemplateVars),
            document: m.mediaUrl
              ? {
                  url: m.mediaUrl,
                  filename: `receipt-${(m.params as TemplateVars | null)?.receipt_no ?? "kiota"}.pdf`,
                }
              : null,
          });
        }
      }
    }
  } catch (err) {
    r = { ok: false, provider: m.channel, error: (err as Error).message, retryable: true };
  }

  return withContext(db, ctx, async (tx) => {
    if (r.ok) {
      await tx.message.update({
        where: { id: m.id },
        data: {
          status: "sent",
          sentAt: now,
          provider: r.provider,
          providerMessageId: r.providerMessageId,
          error: null,
          lockedAt: null,
          ...(r.units && r.units !== m.units ? { units: r.units } : {}),
        },
      });
      // Settle: the provider counted a different number of units than we reserved.
      if (m.channel === "sms" && r.units && r.units !== m.units && m.units > 0 && m.costCents > 0) {
        const perUnit = Math.round(m.costCents / m.units);
        const diff = (r.units - m.units) * perUnit;
        if (diff !== 0) {
          await tx.walletEntry.createMany({
            data: [
              {
                schoolId: ctx.schoolId,
                type: "adjustment",
                amountCents: -diff,
                description: `SMS to ${m.toPhone} was ${r.units} units, not ${m.units}`,
                messageId: m.id,
              },
            ],
            skipDuplicates: true,
          });
        }
      }
      return "sent" as const;
    }
    if (r.retryable && m.attempts < MAX_ATTEMPTS) {
      await tx.message.update({
        where: { id: m.id },
        data: {
          status: "queued",
          lockedAt: null,
          error: r.error.slice(0, 300),
          nextAttemptAt: nextSendTime(new Date(now.getTime() + backoffMs(m.attempts)), m.critical),
        },
      });
      return "retrying" as const;
    }
    await failMessage(tx, ctx, m.id, r.error, now);
    return "failed" as const;
  });
}

/**
 * Mark a message failed (once), refund its reserve, and re-send a WhatsApp message by SMS when
 * it was meant to fall back. Safe to call twice: only the first call does anything.
 */
export async function failMessage(tx: Tx, ctx: Ctx, messageId: string, error: string, now: Date) {
  const changed = await tx.message.updateMany({
    where: { id: messageId, status: { in: ["queued", "sending", "sent"] } },
    data: { status: "failed", failedAt: now, error: error.slice(0, 300), lockedAt: null },
  });
  if (changed.count === 0) return false;
  const m = await tx.message.findUniqueOrThrow({ where: { id: messageId } });
  if (m.costCents > 0) {
    await tx.walletEntry.createMany({
      data: [
        {
          schoolId: ctx.schoolId,
          type: "refund",
          amountCents: m.costCents,
          description: `Refund: ${m.channel === "sms" ? "SMS" : "WhatsApp"} to ${m.toPhone} failed`,
          messageId: m.id,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
  }
  if (m.channel === "whatsapp" && m.fallbackToSms) {
    const link = m.guardianLinkId
      ? await tx.guardianLink.findUnique({ where: { id: m.guardianLinkId } })
      : null;
    const { planned } = await planDrafts(tx, ctx.schoolId, [
      {
        recipient: {
          guardianLinkId: m.guardianLinkId,
          studentId: m.studentId,
          phone: m.toPhone,
          language: link?.language ?? m.language,
          whatsapp: false,
        },
        templateKey: m.templateKey,
        channel: "sms",
        critical: m.critical,
        vars: (m.params ?? {}) as TemplateVars,
      },
    ]);
    await queuePlanned(tx, {
      schoolId: ctx.schoolId,
      planned: planned.map((p: Planned) => p),
      mode: "each",
      now,
      createdById: m.createdById,
      campaignId: m.campaignId,
      fallbackOf: new Map(planned.map((p) => [p.id, m.id])),
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Delivery reports
// ---------------------------------------------------------------------------

/**
 * Apply a provider's delivery report. Looks the school up from the provider's message id, then
 * works as the school's automatic-messages member. Idempotent: repeats change nothing.
 */
export async function applyDeliveryReport(
  db: PrismaClient,
  report: {
    provider: string;
    providerMessageId: string;
    outcome: "sent" | "delivered" | "failed" | "pending";
    error?: string | null;
  },
  now = new Date(),
): Promise<"unknown" | "ignored" | "delivered" | "failed" | "sent"> {
  const [row] = await db.$queryRaw<{ id: string | null }[]>`
    SELECT app_message_school(${report.provider}, ${report.providerMessageId}) AS id`;
  if (!row?.id) return "unknown";
  if (report.outcome === "pending") return "ignored";
  const actor = await messagingActor(db, row.id);
  const ctx = { userId: actor.userId, schoolId: row.id };
  return withContext(db, ctx, async (tx) => {
    const m = await tx.message.findUnique({
      where: {
        provider_providerMessageId: {
          provider: report.provider,
          providerMessageId: report.providerMessageId,
        },
      },
    });
    if (!m) return "unknown" as const;
    if (report.outcome === "failed") {
      const done = await failMessage(tx, ctx, m.id, report.error || "Not delivered", now);
      return done ? ("failed" as const) : ("ignored" as const);
    }
    if (report.outcome === "delivered") {
      const n = await tx.message.updateMany({
        where: { id: m.id, status: { in: ["sending", "sent"] } },
        data: { status: "delivered", deliveredAt: now },
      });
      return n.count ? ("delivered" as const) : ("ignored" as const);
    }
    const n = await tx.message.updateMany({
      where: { id: m.id, status: "sending" },
      data: { status: "sent", sentAt: now },
    });
    return n.count ? ("sent" as const) : ("ignored" as const);
  });
}

// ---------------------------------------------------------------------------
// Low balance
// ---------------------------------------------------------------------------

/**
 * Once per drop below the school's threshold (until the next top-up): an in-app notification
 * and a platform SMS (paid by Arend Studio) to everyone who may top up (Director, Bursar).
 */
export async function checkLowBalance(db: PrismaClient, ctx: Ctx, now = new Date()) {
  const alert = await withContext(db, ctx, async (tx) => {
    const w = await lockWallet(tx, ctx.schoolId);
    if (w.lowBalanceAlertedAt || w.balanceCents >= w.lowBalanceThresholdCents) return null;
    await tx.wallet.update({
      where: { schoolId: ctx.schoolId },
      data: { lowBalanceAlertedAt: now },
    });
    const members = await tx.membership.findMany({
      where: {
        status: "active",
        roles: { none: { role: { key: { in: SYSTEM_ROLES } } } },
        OR: [
          {
            roles: { some: { role: { permissions: { some: { permissionKey: "wallet.topup" } } } } },
          },
          { grants: { some: { permissionKey: "wallet.topup" } } },
        ],
      },
      select: { id: true, user: { select: { phone: true } } },
    });
    const school = await tx.school.findUniqueOrThrow({
      where: { id: ctx.schoolId },
      select: { name: true },
    });
    const left = kes(Math.max(0, w.balanceCents));
    if (members.length) {
      await tx.notification.createMany({
        data: members.map((m) => ({
          schoolId: ctx.schoolId,
          membershipId: m.id,
          title: "Messaging wallet is low",
          body: `${left} left. Top up so fee receipts and notices keep reaching parents.`,
          link: "/dashboard/messages/wallet",
        })),
      });
    }
    return { phones: members.map((m) => m.user.phone), school: school.name, left };
  });
  if (!alert) return false;
  for (const phone of alert.phones) {
    await sendPlatformSms({
      to: phone,
      text: `Kiota: the ${alert.school} messaging wallet is low (${alert.left} left). Top up in Kiota under Messages, Wallet.`,
    }).catch((err) => console.error("[messaging] low-balance SMS failed", err));
  }
  return true;
}

export { walletBalance };
