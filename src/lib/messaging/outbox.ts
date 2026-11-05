/**
 * The outbox: turning "tell these guardians this" into queued messages, with their cost
 * reserved from the school's wallet in the same transaction.
 *
 *  1. Plan (pure): pick the guardian's language, WhatsApp or SMS, render the text, count units,
 *     price it. WhatsApp only if the guardian has WhatsApp, WhatsApp is on and the template is
 *     approved; otherwise SMS.
 *  2. Queue: lock the wallet row (so two sends cannot both spend the same shillings), check the
 *     balance, insert the messages and one "reserve" wallet entry each. Non-critical messages
 *     need the money; critical ones may go into the overdraft Arend Studio allows.
 * The worker (worker.ts) sends them; a failed message gets its reserve refunded.
 */
import { randomUUID } from "node:crypto";
import type { MessageChannel } from "@/generated/prisma/client";
import { kes } from "@/lib/fees/allocation";
import type { Tx } from "@/lib/db-core";
import { ValidationError } from "@/lib/service-kit";
import { whatsappEnabled } from "@/lib/whatsapp";
import { nextSendTime } from "./quiet-hours";
import {
  type TemplateRow,
  type TemplateVars,
  pickTemplate,
  renderTemplate,
  renderWhatsAppBody,
  whatsappParams,
  whatsappReady,
} from "./templates";
import { countSms, toPlainSms } from "./units";
import { ensureMessagingMember } from "./system";

/** "account": about the parent's Kiota account (the portal invitation); reaches every guardian. */
export type Category = "fees" | "academics" | "boarding" | "general" | "account";

export type Recipient = {
  guardianLinkId: string | null;
  studentId: string | null;
  phone: string;
  language: "en" | "sw";
  whatsapp: boolean;
};

export type Draft = {
  recipient: Recipient;
  templateKey: string;
  /** Requested channel. WhatsApp falls back to SMS when it cannot be used. */
  channel: MessageChannel;
  vars: TemplateVars;
  /** WhatsApp only: a PDF (receipt) above the text. */
  document?: { url: string; filename: string } | null;
  /** WhatsApp only: send by SMS if WhatsApp cannot be used or fails (default true). */
  fallbackToSms?: boolean;
  /** Overrides the template's own "critical" (an emergency notice). */
  critical?: boolean;
};

export type Prices = { smsUnitPriceCents: number; whatsappPriceCents: number };

export type Planned = {
  id: string;
  recipient: Recipient;
  channel: MessageChannel;
  templateKey: string;
  category: string;
  critical: boolean;
  body: string;
  params: TemplateVars;
  mediaUrl: string | null;
  units: number;
  costCents: number;
  fallbackToSms: boolean;
};

/** Plan one message, or null when it should not be sent at all (WhatsApp-only extra). */
export function planMessage(
  d: Draft,
  templates: readonly TemplateRow[],
  prices: Prices,
  whatsappOn: boolean,
): Planned | null {
  const t = pickTemplate(templates, d.templateKey, d.recipient.language);
  if (!t) throw new Error(`No message template "${d.templateKey}"`);
  const critical = d.critical ?? t.critical;
  const base = {
    id: randomUUID(),
    recipient: d.recipient,
    templateKey: d.templateKey,
    category: t.category,
    critical,
    params: d.vars,
  };
  const fallback = d.fallbackToSms ?? true;
  if (d.channel === "whatsapp") {
    if (whatsappOn && d.recipient.whatsapp && whatsappReady(t) && t.whatsappBody) {
      return {
        ...base,
        channel: "whatsapp",
        body: renderWhatsAppBody(t.whatsappBody, whatsappParams(t, d.vars)),
        mediaUrl: t.whatsappHeader === "document" ? (d.document?.url ?? null) : null,
        units: 1,
        costCents: prices.whatsappPriceCents,
        fallbackToSms: fallback,
      };
    }
    if (!fallback) return null;
  }
  // Sent as plain GSM-7 (sendSms does the same), so units and cost are counted on what goes out.
  const body = toPlainSms(renderTemplate(t.smsBody, d.vars));
  const units = countSms(body).units;
  return {
    ...base,
    channel: "sms",
    body,
    mediaUrl: null,
    units,
    costCents: units * prices.smsUnitPriceCents,
    fallbackToSms: false,
  };
}

export type CostSummary = {
  recipients: number;
  sms: number;
  whatsapp: number;
  units: number;
  costCents: number;
};

export function summarise(planned: readonly Planned[]): CostSummary {
  return {
    recipients: new Set(planned.map((p) => p.recipient.phone)).size,
    sms: planned.filter((p) => p.channel === "sms").length,
    whatsapp: planned.filter((p) => p.channel === "whatsapp").length,
    units: planned.reduce((n, p) => n + p.units, 0),
    costCents: planned.reduce((n, p) => n + p.costCents, 0),
  };
}

export class NotEnoughCreditError extends ValidationError {
  constructor(
    public readonly costCents: number,
    public readonly balanceCents: number,
  ) {
    super(
      `Not enough credit: this costs ${kes(costCents)} and the wallet has ${kes(Math.max(0, balanceCents))}. Top up the wallet first.`,
    );
    this.name = "NotEnoughCreditError";
  }
}

export async function loadTemplates(tx: Tx): Promise<TemplateRow[]> {
  return tx.messageTemplate.findMany();
}

export async function walletBalance(tx: Tx, schoolId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ balance: bigint | null }[]>`
    SELECT sum(amount_cents) AS balance FROM wallet_entries WHERE school_id = ${schoolId}::uuid`;
  return Number(row?.balance ?? 0);
}

/** Lock the school's wallet until the transaction ends and return it with its balance. */
export async function lockWallet(tx: Tx, schoolId: string) {
  const [w] = await tx.$queryRaw<
    {
      sms_unit_price_cents: number;
      whatsapp_price_cents: number;
      overdraft_limit_cents: number;
      low_balance_threshold_cents: number;
      low_balance_alerted_at: Date | null;
    }[]
  >`SELECT sms_unit_price_cents, whatsapp_price_cents, overdraft_limit_cents,
           low_balance_threshold_cents, low_balance_alerted_at
    FROM wallets WHERE school_id = ${schoolId}::uuid FOR UPDATE`;
  if (!w) throw new Error("This school has no messaging wallet");
  return {
    prices: {
      smsUnitPriceCents: w.sms_unit_price_cents,
      whatsappPriceCents: w.whatsapp_price_cents,
    },
    overdraftLimitCents: w.overdraft_limit_cents,
    lowBalanceThresholdCents: w.low_balance_threshold_cents,
    lowBalanceAlertedAt: w.low_balance_alerted_at,
    balanceCents: await walletBalance(tx, schoolId),
  };
}

/** Plan drafts with the wallet's prices (no lock: for previews). */
export async function planDrafts(tx: Tx, schoolId: string, drafts: readonly Draft[]) {
  const [templates, wallet] = await Promise.all([
    loadTemplates(tx),
    tx.wallet.findUniqueOrThrow({ where: { schoolId } }),
  ]);
  const on = whatsappEnabled();
  const planned = drafts
    .map((d) => planMessage(d, templates, wallet, on))
    .filter((p): p is Planned => p !== null);
  return { planned, wallet, balanceCents: await walletBalance(tx, schoolId) };
}

const NOT_SENT_EMPTY = "Not sent: the messaging wallet is empty. Top up to send messages.";

/**
 * Queue planned messages and reserve their cost.
 *  - "all": a bulk send the person confirmed. Refuses (NotEnoughCreditError) unless the wallet
 *    covers everything (critical sends may use the overdraft).
 *  - "each": automatic messages (payment confirmations). Each goes if the wallet covers it;
 *    the others are recorded as failed, at no cost, so the history shows why.
 */
export async function queuePlanned(
  tx: Tx,
  opts: {
    schoolId: string;
    planned: readonly Planned[];
    mode: "all" | "each";
    now?: Date;
    createdById?: string | null;
    campaignId?: string | null;
    fallbackOf?: Map<string, string>;
  },
) {
  const now = opts.now ?? new Date();
  if (opts.planned.length === 0) return { queued: 0, notSent: 0, costCents: 0 };
  await ensureMessagingMember(tx, opts.schoolId);
  const wallet = await lockWallet(tx, opts.schoolId);
  const floor = (critical: boolean) => (critical ? -wallet.overdraftLimitCents : 0);

  if (opts.mode === "all") {
    const cost = opts.planned.reduce((n, p) => n + p.costCents, 0);
    const critical = opts.planned.every((p) => p.critical);
    if (wallet.balanceCents - cost < floor(critical)) {
      throw new NotEnoughCreditError(cost, wallet.balanceCents);
    }
  }

  let running = wallet.balanceCents;
  const rows = [];
  const entries = [];
  let notSent = 0;
  for (const p of opts.planned) {
    const affordable = running - p.costCents >= floor(p.critical);
    if (!affordable) notSent++;
    rows.push({
      id: p.id,
      schoolId: opts.schoolId,
      campaignId: opts.campaignId ?? null,
      studentId: p.recipient.studentId,
      guardianLinkId: p.recipient.guardianLinkId,
      toPhone: p.recipient.phone,
      channel: p.channel,
      language: p.recipient.language,
      templateKey: p.templateKey,
      category: p.category,
      critical: p.critical,
      body: p.body,
      params: p.params as object,
      mediaUrl: p.mediaUrl,
      units: p.units,
      costCents: affordable ? p.costCents : 0,
      status: affordable ? ("queued" as const) : ("failed" as const),
      error: affordable ? null : NOT_SENT_EMPTY,
      failedAt: affordable ? null : now,
      nextAttemptAt: nextSendTime(now, p.critical),
      fallbackToSms: p.fallbackToSms,
      fallbackOfId: opts.fallbackOf?.get(p.id) ?? null,
      createdById: opts.createdById ?? null,
      createdAt: now,
    });
    if (affordable && p.costCents > 0) {
      running -= p.costCents;
      entries.push({
        schoolId: opts.schoolId,
        type: "reserve" as const,
        amountCents: -p.costCents,
        description: `${p.channel === "sms" ? `SMS (${p.units} unit${p.units === 1 ? "" : "s"})` : "WhatsApp"} to ${p.recipient.phone}`,
        messageId: p.id,
        createdById: opts.createdById ?? null,
        createdAt: now,
      });
    }
  }
  await tx.message.createMany({ data: rows });
  if (entries.length) await tx.walletEntry.createMany({ data: entries });
  return {
    queued: rows.length - notSent,
    notSent,
    costCents: wallet.balanceCents - running,
  };
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/** Which guardian setting a category needs. "general" reaches everyone but fee-only contacts. */
export function categoryFilter(category: Category) {
  switch (category) {
    case "fees":
      return { receivesFees: true };
    case "academics":
      return { receivesAcademics: true };
    case "boarding":
      return { receivesBoarding: true };
    case "account":
      return {};
    default:
      return { OR: [{ receivesAcademics: true }, { receivesBoarding: true }] };
  }
}

/** Guardians of the given students who want this category of message, one row per link. */
export async function guardianRecipients(
  tx: Tx,
  where: {
    schoolId: string;
    studentIds?: string[];
    students?: object;
    /** Only guardians who have never signed in to the parent portal. */
    notSignedIn?: boolean;
  },
  category: Category,
): Promise<Recipient[]> {
  const links = await tx.guardianLink.findMany({
    where: {
      // Row-level security scopes this too; the explicit filter is the first wall.
      schoolId: where.schoolId,
      ...categoryFilter(category),
      ...(where.notSignedIn ? { portalFirstSeenAt: null } : {}),
      ...(where.studentIds ? { studentId: { in: where.studentIds } } : {}),
      student: { status: "active", ...(where.students ?? {}) },
    },
    select: {
      id: true,
      studentId: true,
      language: true,
      whatsapp: true,
      user: { select: { phone: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => ({
    guardianLinkId: l.id,
    studentId: l.studentId,
    phone: l.user.phone,
    language: l.language,
    whatsapp: l.whatsapp,
  }));
}

/** One message per phone number (a parent of three children gets a notice once). */
export function onePerPhone(recipients: readonly Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return recipients.filter((r) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)));
}
