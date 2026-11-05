/**
 * The school's messaging wallet: what it holds, how it was spent, and how money gets in.
 *
 * Top-ups by M-Pesa go to Arend Studio's OWN Paybill/Till (platform Daraja credentials in the
 * environment, PLATFORM_MPESA_*), never to the school's fee Paybill. The M-Pesa module's safety
 * rules apply: the callback URL carries a secret token, every payment is confirmed with
 * Daraja's STK query before it is credited, and each top-up can be credited once only (unique
 * wallet_entries.topup_id), however many callbacks arrive.
 *
 * Arend admins set prices, overdraft and sender ID, and credit bank transfers or starter
 * credit, through SECURITY DEFINER functions that check is_platform_admin and audit.
 */
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { sha256 } from "@/lib/crypto";
import { scopedDb, withContext } from "@/lib/db-core";
import { type DarajaCredentials, darajaDriver } from "@/lib/mpesa/daraja";
import { callbackBase } from "@/lib/mpesa/service";
import { normalizePhone } from "@/lib/phone";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import { walletBalance } from "./outbox";
import { canSeeMessages } from "./service";
import { ensureMessagingMember, messagingActor } from "./system";

export const MIN_TOPUP_SHILLINGS = 10;
export const MAX_TOPUP_SHILLINGS = 150_000;

// ---------------------------------------------------------------------------
// Arend Studio's own Paybill (platform Daraja settings)
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

export function platformMpesa(env: Env = process.env) {
  const environment = env.PLATFORM_MPESA_ENVIRONMENT;
  const shortcode = env.PLATFORM_MPESA_SHORTCODE;
  const token = env.PLATFORM_MPESA_CALLBACK_TOKEN;
  if (!environment || !shortcode || !token) return null;
  if (!["simulator", "sandbox", "production"].includes(environment)) return null;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const creds: DarajaCredentials = {
    environment: environment as DarajaCredentials["environment"],
    shortcode,
    shortcodeType: env.PLATFORM_MPESA_SHORTCODE_TYPE === "till" ? "till" : "paybill",
    consumerKey: env.PLATFORM_MPESA_CONSUMER_KEY || null,
    consumerSecret: env.PLATFORM_MPESA_CONSUMER_SECRET || null,
    passkey: env.PLATFORM_MPESA_PASSKEY || null,
    initiatorName: null,
    securityCredential: null,
  };
  return { creds, token };
}

/** Daraja rejects callback URLs containing "mpesa", hence /api/pay/topup/... */
export function topupCallbackUrl(token: string) {
  return `${callbackBase()}/api/pay/topup/${token}/stk`;
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(sha256(a), "hex");
  const y = Buffer.from(sha256(b), "hex");
  return timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// The school's view
// ---------------------------------------------------------------------------

export async function walletOverview({ db }: Deps, actor: Actor) {
  if (!canSeeMessages(actor.permissions)) throw new ForbiddenError("wallet.topup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const monthStart = new Date(
      new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7) + "-01T00:00:00+03:00",
    );
    const [wallet, balanceCents, topups, months, campaigns, automatic] = await Promise.all([
      tx.wallet.findUniqueOrThrow({ where: { schoolId: actor.schoolId } }),
      walletBalance(tx, actor.schoolId),
      tx.walletTopup.findMany({
        where: { schoolId: actor.schoolId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      tx.$queryRaw<{ month: string; spent: bigint; units: bigint }[]>`
        SELECT to_char(date_trunc('month', e.created_at AT TIME ZONE 'Africa/Nairobi'), 'YYYY-MM') AS month,
               -sum(e.amount_cents) AS spent,
               count(*) FILTER (WHERE e.type = 'reserve') AS units
        FROM wallet_entries e
        WHERE e.school_id = ${actor.schoolId}::uuid AND e.type IN ('reserve', 'refund', 'adjustment')
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      tx.$queryRaw<
        {
          id: string;
          title: string;
          kind: string;
          created_at: Date;
          recipients: number;
          spent: bigint | null;
        }[]
      >`
        SELECT c.id, c.title, c.kind, c.created_at, c.recipients,
               (SELECT -sum(e.amount_cents) FROM wallet_entries e
                WHERE e.message_id IN (SELECT m.id FROM messages m WHERE m.campaign_id = c.id)) AS spent
        FROM message_campaigns c WHERE c.school_id = ${actor.schoolId}::uuid
        ORDER BY c.created_at DESC LIMIT 20`,
      tx.$queryRaw<{ spent: bigint | null; messages: bigint }[]>`
        SELECT -sum(e.amount_cents) AS spent, count(DISTINCT m.id) AS messages
        FROM messages m JOIN wallet_entries e ON e.message_id = m.id
        WHERE m.school_id = ${actor.schoolId}::uuid AND m.campaign_id IS NULL
          AND m.created_at >= ${monthStart}::timestamptz`,
    ]);
    return {
      balanceCents,
      prices: {
        smsUnitPriceCents: wallet.smsUnitPriceCents,
        whatsappPriceCents: wallet.whatsappPriceCents,
      },
      overdraftLimitCents: wallet.overdraftLimitCents,
      lowBalanceThresholdCents: wallet.lowBalanceThresholdCents,
      senderId: wallet.senderIdApproved ? wallet.senderId : null,
      senderIdPending: !wallet.senderIdApproved && wallet.senderId ? wallet.senderId : null,
      topups,
      months: months.map((m) => ({
        month: m.month,
        spentCents: Number(m.spent),
        messages: Number(m.units),
      })),
      campaigns: campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        createdAt: c.created_at,
        recipients: c.recipients,
        spentCents: Number(c.spent ?? 0),
      })),
      automaticThisMonth: {
        spentCents: Number(automatic[0]?.spent ?? 0),
        messages: Number(automatic[0]?.messages ?? 0),
      },
      mpesaTopups: platformMpesa() !== null,
    };
  });
}

export async function setLowBalanceThreshold({ db }: Deps, actor: Actor, raw: unknown) {
  assertCan(actor.permissions, "wallet.topup");
  const parsed = parseKesToCents(raw);
  if ("error" in parsed || parsed.cents === null || parsed.cents < 0 || parsed.cents > 100_000_000)
    throw new ValidationError("Enter the amount in shillings, for example 500.", "threshold");
  return withContext(db, ctxOf(actor), async (tx) => {
    const before = await tx.wallet.findUniqueOrThrow({ where: { schoolId: actor.schoolId } });
    await tx.wallet.update({
      where: { schoolId: actor.schoolId },
      data: { lowBalanceThresholdCents: parsed.cents!, lowBalanceAlertedAt: null },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "wallet.threshold",
      targetType: "wallet",
      targetId: actor.schoolId,
      before: { lowBalanceThresholdCents: before.lowBalanceThresholdCents },
      after: { lowBalanceThresholdCents: parsed.cents },
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// M-Pesa top-up (STK Push to Arend Studio's Paybill)
// ---------------------------------------------------------------------------

export async function requestWalletTopup(
  { db }: Deps,
  actor: Actor,
  raw: { amount: unknown; phone: unknown },
) {
  assertCan(actor.permissions, "wallet.topup");
  const cfg = platformMpesa();
  if (!cfg)
    throw new ValidationError(
      "M-Pesa top-ups are not switched on yet. Ask Arend Studio to top up by bank transfer.",
    );
  const phone = normalizePhone(String(raw.phone ?? ""));
  if (!phone || !phone.startsWith("+254"))
    throw new ValidationError("Enter a Kenyan M-Pesa number, like 0712 345 678.", "phone");
  const amount = Number(clean(raw.amount)?.replace(/,/g, ""));
  if (!Number.isInteger(amount) || amount < MIN_TOPUP_SHILLINGS || amount > MAX_TOPUP_SHILLINGS) {
    throw new ValidationError(
      `Enter whole shillings from ${MIN_TOPUP_SHILLINGS} to ${MAX_TOPUP_SHILLINGS.toLocaleString("en-KE")}.`,
      "amount",
    );
  }
  const school = await withContext(db, ctxOf(actor), async (tx) => {
    await ensureMessagingMember(tx, actor.schoolId);
    return tx.school.findUniqueOrThrow({
      where: { id: actor.schoolId },
      select: { shortName: true },
    });
  });
  const res = await darajaDriver(cfg.creds.environment).stkPush(cfg.creds, {
    phone: phone.slice(1),
    amountShillings: amount,
    accountReference: `SMS ${school.shortName}`.slice(0, 12),
    description: "Kiota SMS",
    callbackUrl: topupCallbackUrl(cfg.token),
  });
  return withContext(db, ctxOf(actor), async (tx) => {
    const row = await tx.walletTopup.create({
      data: {
        schoolId: actor.schoolId,
        method: "mpesa",
        amountCents: amount * 100,
        status: "stk_requested",
        phone,
        checkoutRequestId: res.checkoutRequestId,
        requestedById: actor.userId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "wallet.topup.request",
      targetType: "wallet_topup",
      targetId: row.id,
      after: { phone, amountCents: amount * 100, checkoutRequestId: res.checkoutRequestId },
      ip: actor.ip,
    });
    return { id: row.id, message: res.customerMessage };
  });
}

type StkBody = {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string | null;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: unknown }[] };
    };
  };
};

/** Daraja's STK callback for a wallet top-up. Public; the token in the URL is the secret. */
export async function handleTopupCallback(db: PrismaClient, token: string, body: StkBody) {
  const cfg = platformMpesa();
  if (!cfg || !sameToken(token, cfg.token)) return { status: 404 as const };
  const cb = body.Body?.stkCallback;
  const checkoutRequestId = clean(cb?.CheckoutRequestID);
  if (!cb || !checkoutRequestId) return { status: 200 as const, outcome: "ignored" };
  const [found] = await db.$queryRaw<{ id: string | null }[]>`
    SELECT app_wallet_topup_school(${checkoutRequestId}) AS id`;
  if (!found?.id) return { status: 200 as const, outcome: "unknown" };
  const actor = await messagingActor(db, found.id);
  const items = cb.CallbackMetadata?.Item ?? [];
  const item = (n: string) => items.find((i) => i.Name === n)?.Value;

  const next = await withContext(db, ctxOf(actor), async (tx) => {
    const row = await tx.walletTopup.findUnique({
      where: { schoolId: actor.schoolId, checkoutRequestId },
    });
    if (!row || row.status !== "stk_requested") return null; // a repeat callback
    if (String(cb.ResultCode) !== "0") {
      await tx.walletTopup.update({
        where: { schoolId: actor.schoolId, id: row.id },
        data: { status: "failed", statusDetail: (cb.ResultDesc ?? "Not paid").slice(0, 300) },
      });
      return null;
    }
    const paid = parseKesToCents(item("Amount") as string | number | undefined);
    const paidCents = "error" in paid ? null : paid.cents;
    if (paidCents !== null && paidCents !== row.amountCents) {
      await tx.walletTopup.update({
        where: { schoolId: actor.schoolId, id: row.id },
        data: {
          status: "failed",
          statusDetail: "The amount does not match the request. Not credited.",
        },
      });
      return null;
    }
    const transId = String(item("MpesaReceiptNumber") ?? "").toUpperCase() || null;
    await tx.walletTopup.update({
      where: { schoolId: actor.schoolId, id: row.id },
      data: { status: "pending_verification", transId },
    });
    return row.id;
  }).catch((err) => {
    // The same M-Pesa receipt number twice: the unique key stops the second.
    if (String(err).includes("Unique constraint")) return null;
    throw err;
  });
  if (!next) return { status: 200 as const, outcome: "duplicate" };
  return { status: 200 as const, outcome: await verifyAndCredit(db, actor, next) };
}

/** Ask Safaricom whether the prompt was really paid, then credit the wallet once. */
async function verifyAndCredit(db: PrismaClient, actor: Actor, topupId: string) {
  const cfg = platformMpesa();
  if (!cfg) return "verification_failed";
  const row = await withContext(db, ctxOf(actor), (tx) =>
    tx.walletTopup.findUniqueOrThrow({ where: { schoolId: actor.schoolId, id: topupId } }),
  );
  let detail: string;
  try {
    const q = await darajaDriver(cfg.creds.environment).stkQuery(cfg.creds, row.checkoutRequestId!);
    if (q.resultCode === "0") return creditTopup(db, actor, topupId);
    detail = `Safaricom STK check: ${q.resultDesc}`;
  } catch (err) {
    detail = `Could not reach Safaricom to confirm: ${(err as Error).message}`;
  }
  await withContext(db, ctxOf(actor), (tx) =>
    tx.walletTopup.updateMany({
      where: {
        schoolId: actor.schoolId,
        id: topupId,
        status: { in: ["pending_verification", "verification_failed"] },
      },
      data: { status: "verification_failed", statusDetail: detail.slice(0, 300) },
    }),
  );
  return "verification_failed";
}

async function creditTopup(db: PrismaClient, actor: Actor, topupId: string) {
  return withContext(db, ctxOf(actor), async (tx) => {
    const claimed = await tx.walletTopup.updateMany({
      where: {
        schoolId: actor.schoolId,
        id: topupId,
        status: { in: ["pending_verification", "verification_failed"] },
      },
      data: { status: "posting" },
    });
    if (claimed.count === 0) return "duplicate";
    const row = await tx.walletTopup.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: topupId },
    });
    await tx.walletEntry.create({
      data: {
        schoolId: row.schoolId,
        type: "topup",
        amountCents: row.amountCents,
        description: `M-Pesa top-up${row.transId ? ` ${row.transId}` : ""}`,
        topupId: row.id,
        createdById: row.requestedById,
      },
    });
    await tx.walletTopup.update({
      where: { schoolId: actor.schoolId, id: row.id },
      data: { status: "completed", statusDetail: null, completedAt: new Date() },
    });
    await tx.wallet.update({
      where: { schoolId: row.schoolId },
      data: { lowBalanceAlertedAt: null },
    });
    await audit(tx, {
      schoolId: row.schoolId,
      actorId: actor.userId,
      action: "wallet.topup",
      targetType: "wallet_topup",
      targetId: row.id,
      after: { amountCents: row.amountCents, transId: row.transId, phone: row.phone },
    });
    return "completed";
  });
}

/** "Check again" for a top-up whose confirmation failed or timed out. */
export async function retryTopup({ db }: Deps, actor: Actor, topupId: string) {
  assertCan(actor.permissions, "wallet.topup");
  const row = await withContext(db, ctxOf(actor), (tx) =>
    tx.walletTopup.findUnique({ where: { schoolId: actor.schoolId, id: topupId } }),
  );
  if (
    !row ||
    !["verification_failed", "pending_verification", "stk_requested"].includes(row.status)
  )
    throw new ValidationError("This top-up cannot be checked again.");
  if (row.status === "stk_requested") {
    await withContext(db, ctxOf(actor), (tx) =>
      tx.walletTopup.updateMany({
        where: { schoolId: actor.schoolId, id: topupId, status: "stk_requested" },
        data: { status: "pending_verification" },
      }),
    );
  }
  return verifyAndCredit(db, await messagingActor(db, actor.schoolId), topupId);
}

// ---------------------------------------------------------------------------
// Arend admin (platform level)
// ---------------------------------------------------------------------------

export type PlatformAdmin = { userId: string; isPlatformAdmin: boolean; ip?: string | null };

const adminCtx = (a: PlatformAdmin) => ({ userId: a.userId, schoolId: null });

function assertAdmin(a: PlatformAdmin) {
  if (!a.isPlatformAdmin) throw new ForbiddenError("platform.admin");
}

export async function adminWallets({ db }: Deps, admin: PlatformAdmin) {
  assertAdmin(admin);
  const rows = await scopedDb(db, adminCtx(admin)).$queryRaw<
    {
      school_id: string;
      name: string;
      short_name: string;
      status: string;
      balance_cents: bigint;
      used_this_month_cents: bigint;
      messages_this_month: bigint;
      sms_unit_price_cents: number;
      whatsapp_price_cents: number;
      overdraft_limit_cents: number;
      low_balance_threshold_cents: number;
      sender_id: string | null;
      sender_id_approved: boolean;
    }[]
  >`SELECT * FROM app_admin_wallets()`;
  return rows.map((r) => ({
    schoolId: r.school_id,
    name: r.name,
    shortName: r.short_name,
    status: r.status,
    balanceCents: Number(r.balance_cents),
    usedThisMonthCents: Number(r.used_this_month_cents),
    messagesThisMonth: Number(r.messages_this_month),
    smsUnitPriceCents: r.sms_unit_price_cents,
    whatsappPriceCents: r.whatsapp_price_cents,
    overdraftLimitCents: r.overdraft_limit_cents,
    lowBalanceThresholdCents: r.low_balance_threshold_cents,
    senderId: r.sender_id,
    senderIdApproved: r.sender_id_approved,
  }));
}

function cents(raw: unknown, field: string, label: string) {
  const p = parseKesToCents(raw);
  if ("error" in p || p.cents === null || p.cents < 0 || p.cents > 100_000_000)
    throw new ValidationError(`Enter ${label} in shillings, for example 1.20.`, field);
  return p.cents;
}

export async function adminSetWallet(
  { db }: Deps,
  admin: PlatformAdmin,
  schoolId: string,
  raw: Record<string, unknown>,
) {
  assertAdmin(admin);
  const sms = cents(raw.smsPrice, "smsPrice", "the price per SMS");
  const whatsapp = cents(raw.whatsappPrice, "whatsappPrice", "the price per WhatsApp message");
  const overdraft = cents(raw.overdraft, "overdraft", "the overdraft");
  const senderId = (clean(raw.senderId) ?? "").toUpperCase();
  if (senderId && !/^[A-Z0-9][A-Z0-9 _-]{1,10}$/.test(senderId))
    throw new ValidationError("A sender ID is 2 to 11 letters or digits.", "senderId");
  const approved = raw.senderIdApproved === "on" || raw.senderIdApproved === true;
  await withContext(
    db,
    adminCtx(admin),
    (tx) =>
      tx.$executeRaw`SELECT app_admin_set_wallet(${schoolId}::uuid, ${sms}::int, ${whatsapp}::int,
      ${overdraft}::int, ${senderId}, ${approved}, ${admin.ip ?? null})`,
  );
}

export async function adminCreditWallet(
  { db }: Deps,
  admin: PlatformAdmin,
  schoolId: string,
  raw: Record<string, unknown>,
) {
  assertAdmin(admin);
  const kind = raw.kind === "starter" ? "starter" : "manual";
  const amount = cents(raw.amount, "amount", "the amount");
  if (amount <= 0) throw new ValidationError("Enter an amount above zero.", "amount");
  const reference = clean(raw.reference);
  if (kind === "manual" && !reference)
    throw new ValidationError("Enter the bank transfer reference.", "reference");
  const [row] = await withContext(
    db,
    adminCtx(admin),
    (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT app_admin_credit_wallet(${schoolId}::uuid, ${kind},
      ${amount}::int, ${reference}, ${clean(raw.note)}, ${admin.ip ?? null}) AS id`,
  );
  return row.id;
}

export async function adminTemplates({ db }: Deps, admin: PlatformAdmin) {
  assertAdmin(admin);
  return scopedDb(db, adminCtx(admin)).messageTemplate.findMany({
    orderBy: [{ key: "asc" }, { language: "asc" }],
  });
}

export const WHATSAPP_STATUSES = ["not_submitted", "pending", "approved", "rejected"] as const;

export async function adminSetTemplateStatus(
  { db }: Deps,
  admin: PlatformAdmin,
  key: string,
  language: string,
  status: string,
) {
  assertAdmin(admin);
  if (!(WHATSAPP_STATUSES as readonly string[]).includes(status))
    throw new ValidationError("Choose a status.");
  if (language !== "en" && language !== "sw") throw new ValidationError("Choose a language.");
  await withContext(db, adminCtx(admin), async (tx) => {
    const before = await tx.messageTemplate.findUnique({
      where: { key_language: { key, language } },
    });
    if (!before) throw new ValidationError("Template not found.");
    await tx.messageTemplate.update({
      where: { key_language: { key, language } },
      data: { whatsappStatus: status },
    });
    await audit(tx, {
      schoolId: null,
      actorId: admin.userId,
      action: "template.whatsapp_status",
      targetType: "message_template",
      targetId: `${key}:${language}`,
      before: { whatsappStatus: before.whatsappStatus },
      after: { whatsappStatus: status },
      ip: admin.ip,
    });
  });
}
