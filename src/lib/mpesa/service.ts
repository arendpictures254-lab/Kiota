/**
 * M-Pesa for one school: settings, C2B (Paybill) callbacks, STK Push, suspense.
 *
 * Callbacks are not signed by Safaricom, so:
 *  1. each school's callback URLs carry a secret token (only its hash is stored for lookup);
 *  2. every C2B payment is confirmed with Daraja's transaction status query, and every STK
 *     payment with the STK query, BEFORE a payment is posted;
 *  3. everything is idempotent on the M-Pesa transaction ID: the same callback twice never
 *     creates two payments (unique keys in the database, not just checks in code).
 * Callbacks run as the school's hidden "Automatic payments" member, so row-level security
 * and permissions apply to them like to anyone else.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { assertCan, effectivePermissions } from "@/lib/auth/permissions";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { withContext, type Tx } from "@/lib/db-core";
import { postPayment } from "@/lib/fees/payments";
import { APP_URL } from "@/lib/hosts";
import { normalizePhone } from "@/lib/phone";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { parseKesToCents } from "@/lib/students/rules";
import { type DarajaCredentials, darajaDriver, parseDarajaTime } from "./daraja";

export const SYSTEM_PHONE = "system:payments";
const SYSTEM_ROLE = "system_payments";
const MAX_STK_SHILLINGS = 250_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The account number parents type is the admission number: compare ignoring case and symbols. */
export function normaliseAccount(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function callbackBase() {
  // `||`, not `??`: Docker passes an unset optional variable as an empty string.
  return (process.env.MPESA_CALLBACK_BASE_URL || APP_URL).replace(/\/$/, "");
}

/** Daraja rejects callback URLs containing words like "mpesa" or "query", hence /api/pay/... */
export function callbackUrls(token: string) {
  const base = `${callbackBase()}/api/pay/${token}`;
  return {
    confirmation: `${base}/c2b/confirm`,
    validation: `${base}/c2b/validate`,
    stk: `${base}/stk/callback`,
    statusResult: `${base}/status/result`,
    statusTimeout: `${base}/status/timeout`,
  };
}

function credentialsFrom(s: {
  environment: string;
  shortcode: string;
  shortcodeType: string;
  consumerKeyEnc: string | null;
  consumerSecretEnc: string | null;
  passkeyEnc: string | null;
  initiatorName: string | null;
  securityCredentialEnc: string | null;
}): DarajaCredentials {
  const dec = (v: string | null) => (v ? decryptSecret(v) : null);
  return {
    environment: s.environment as DarajaCredentials["environment"],
    shortcode: s.shortcode,
    shortcodeType: s.shortcodeType === "till" ? "till" : "paybill",
    consumerKey: dec(s.consumerKeyEnc),
    consumerSecret: dec(s.consumerSecretEnc),
    passkey: dec(s.passkeyEnc),
    initiatorName: s.initiatorName,
    securityCredential: dec(s.securityCredentialEnc),
  };
}

const systemPermissions = effectivePermissions({
  rolePermissions: BUILT_IN_ROLES.find((r) => r.key === SYSTEM_ROLE)!.permissions,
  grants: [],
});

/** The school's hidden automatic-payments member, used to run callbacks. */
async function systemActor(db: PrismaClient, schoolId: string): Promise<Actor> {
  const [row] = await db.$queryRaw<
    { id: string | null }[]
  >`SELECT app_auth_user_id(${SYSTEM_PHONE}) AS id`;
  if (!row?.id) throw new Error("Automatic payments are not set up");
  return { userId: row.id, schoolId, permissions: systemPermissions, ip: null };
}

async function ensureSystemMember(tx: Tx, schoolId: string) {
  const [{ id: userId }] = await tx.$queryRaw<{ id: string }[]>`
    SELECT app_ensure_user(${SYSTEM_PHONE}, 'Kiota automatic payments') AS id`;
  const membership = await tx.membership.upsert({
    where: { schoolId_userId: { schoolId, userId } },
    create: { schoolId, userId, displayName: "M-Pesa (automatic)" },
    update: { status: "active" },
  });
  const role = await tx.role.findUniqueOrThrow({ where: { schoolId: null, key: SYSTEM_ROLE } });
  await tx.membershipRole.upsert({
    where: { schoolId, membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
    create: { schoolId, membershipId: membership.id, roleId: role.id },
    update: {},
  });
}

async function schoolForToken(db: PrismaClient, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db.$queryRaw<
    { id: string | null }[]
  >`SELECT app_mpesa_school_for_token(${sha256(token)}) AS id`;
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type MpesaSettingsInput = {
  shortcode: unknown;
  shortcodeType: unknown;
  environment: unknown;
  consumerKey?: unknown;
  consumerSecret?: unknown;
  passkey?: unknown;
  initiatorName?: unknown;
  securityCredential?: unknown;
};

/** Save settings. Blank secret fields keep the saved value. Secrets are encrypted at rest. */
export async function saveMpesaSettings({ db }: Deps, actor: Actor, raw: MpesaSettingsInput) {
  assertCan(actor.permissions, "fees.setup");
  const shortcode = clean(raw.shortcode);
  if (!shortcode || !/^\d{5,7}$/.test(shortcode))
    throw new ValidationError("Enter the Paybill or Till number (5 to 7 digits).", "shortcode");
  const shortcodeType = raw.shortcodeType === "till" ? "till" : "paybill";
  const environment = String(raw.environment ?? "");
  if (!["simulator", "sandbox", "production"].includes(environment))
    throw new ValidationError("Choose simulator, sandbox or live.", "environment");

  return withContext(db, ctxOf(actor), async (tx) => {
    const existing = await tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } });
    const secret = (v: unknown, current: string | null | undefined) => {
      const s = clean(v);
      return s ? encryptSecret(s) : (current ?? null);
    };
    const data = {
      shortcode,
      shortcodeType,
      environment,
      consumerKeyEnc: secret(raw.consumerKey, existing?.consumerKeyEnc),
      consumerSecretEnc: secret(raw.consumerSecret, existing?.consumerSecretEnc),
      passkeyEnc: secret(raw.passkey, existing?.passkeyEnc),
      initiatorName: clean(raw.initiatorName) ?? existing?.initiatorName ?? null,
      securityCredentialEnc: secret(raw.securityCredential, existing?.securityCredentialEnc),
      updatedById: actor.userId,
    };
    if (environment !== "simulator") {
      const missing = [
        !data.consumerKeyEnc && "consumer key",
        !data.consumerSecretEnc && "consumer secret",
        !data.passkeyEnc && "passkey",
        !data.initiatorName && "initiator name",
        !data.securityCredentialEnc && "security credential",
      ].filter(Boolean);
      if (missing.length)
        throw new ValidationError(`Enter the ${missing.join(", ")} from the Daraja portal.`);
    }
    let token: string | null = null;
    if (existing) {
      await tx.mpesaSettings.update({ where: { schoolId: actor.schoolId }, data });
    } else {
      token = randomToken();
      await tx.mpesaSettings.create({
        data: {
          ...data,
          schoolId: actor.schoolId,
          callbackTokenEnc: encryptSecret(token),
          callbackTokenHash: sha256(token),
        },
      });
    }
    await ensureSystemMember(tx, actor.schoolId);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.mpesa.settings",
      targetType: "school",
      targetId: actor.schoolId,
      // Never the secrets themselves: only which ones are set.
      after: {
        shortcode,
        shortcodeType,
        environment,
        consumerKey: !!data.consumerKeyEnc,
        consumerSecret: !!data.consumerSecretEnc,
        passkey: !!data.passkeyEnc,
        initiatorName: data.initiatorName,
        securityCredential: !!data.securityCredentialEnc,
      },
      ip: actor.ip,
    });
  });
}

export async function getMpesaSettings({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "fees.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const s = await tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } });
    if (!s) return null;
    return {
      shortcode: s.shortcode,
      shortcodeType: s.shortcodeType,
      environment: s.environment,
      hasConsumerKey: !!s.consumerKeyEnc,
      hasConsumerSecret: !!s.consumerSecretEnc,
      hasPasskey: !!s.passkeyEnc,
      initiatorName: s.initiatorName,
      hasSecurityCredential: !!s.securityCredentialEnc,
      urls: callbackUrls(decryptSecret(s.callbackTokenEnc)),
      updatedAt: s.updatedAt,
    };
  });
}

/** Register the C2B confirmation/validation URLs with Safaricom. */
export async function registerC2BUrls({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "fees.setup");
  const s = await withContext(db, ctxOf(actor), (tx) =>
    tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } }),
  );
  if (!s) throw new ValidationError("Save the M-Pesa settings first.");
  const urls = callbackUrls(decryptSecret(s.callbackTokenEnc));
  await darajaDriver(s.environment as DarajaCredentials["environment"]).registerUrls(
    credentialsFrom(s),
    {
      confirmationUrl: urls.confirmation,
      validationUrl: urls.validation,
    },
  );
  await withContext(db, ctxOf(actor), (tx) =>
    audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.mpesa.register_urls",
      targetType: "school",
      targetId: actor.schoolId,
      after: { confirmation: urls.confirmation.replace(/\/api\/pay\/[^/]+/, "/api/pay/***") },
      ip: actor.ip,
    }),
  );
}

// ---------------------------------------------------------------------------
// Posting a confirmed M-Pesa payment
// ---------------------------------------------------------------------------

async function settingsFor(tx: Tx, schoolId: string) {
  const s = await tx.mpesaSettings.findUnique({ where: { schoolId } });
  if (!s) throw new Error("M-Pesa is not set up for this school");
  return s;
}

async function matchStudent(tx: Tx, billRef: string | null) {
  if (!billRef) return null;
  const norm = normaliseAccount(billRef);
  if (!norm) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM students
    WHERE regexp_replace(upper(admission_number), '[^A-Z0-9]', '', 'g') = ${norm}
    LIMIT 2`;
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Safaricom has confirmed the transaction: post it to the student (STK: the student it was
 * requested for; C2B: the admission number typed as the account) or put it in suspense.
 * Claims the row first, so two parallel confirmations cannot both post.
 */
async function postConfirmed(
  db: PrismaClient,
  actor: Actor,
  txnId: string,
  confirmedAmountCents: number | null,
) {
  return withContext(db, ctxOf(actor), async (tx) => {
    const claimed = await tx.mpesaTransaction.updateMany({
      where: {
        schoolId: actor.schoolId,
        id: txnId,
        status: { in: ["pending_verification", "verification_failed"] },
      },
      data: { status: "posting" },
    });
    if (claimed.count === 0) return null;
    const row = await tx.mpesaTransaction.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: txnId },
    });

    if (confirmedAmountCents !== null && confirmedAmountCents !== row.amountCents) {
      await tx.mpesaTransaction.update({
        where: { schoolId: actor.schoolId, id: txnId },
        data: {
          status: "rejected",
          statusDetail: "The amount does not match Safaricom's record. Not posted.",
        },
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "fees.mpesa.rejected",
        targetType: "mpesa_transaction",
        targetId: txnId,
        after: { transId: row.transId, callbackAmountCents: row.amountCents, confirmedAmountCents },
      });
      return "rejected";
    }

    const studentId = row.kind === "stk" ? row.studentId : await matchStudent(tx, row.billRef);
    if (!studentId) {
      await tx.mpesaTransaction.update({
        where: { schoolId: actor.schoolId, id: txnId },
        data: {
          status: "suspense",
          statusDetail: row.billRef
            ? `No student with admission number "${row.billRef}".`
            : "No account number given.",
        },
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "fees.mpesa.suspense",
        targetType: "mpesa_transaction",
        targetId: txnId,
        after: { transId: row.transId, billRef: row.billRef, amountCents: row.amountCents },
      });
      return "suspense";
    }

    const { payment } = await postPayment(tx, actor, {
      studentId,
      method: "mpesa",
      amountCents: row.amountCents!,
      reference: row.transId,
      payerName: row.payerName,
      payerPhone: row.msisdn ? normalizePhone(row.msisdn) : null,
      paidAt: row.transTime ?? new Date(),
      mpesaTransactionId: row.id,
    });
    await tx.mpesaTransaction.update({
      where: { schoolId: actor.schoolId, id: txnId },
      data: { status: "posted", statusDetail: null, studentId, paymentId: payment.id },
    });
    return "posted";
  });
}

async function verifyAndPost(db: PrismaClient, actor: Actor, txnId: string, token: string) {
  const { row, settings } = await withContext(db, ctxOf(actor), async (tx) => ({
    row: await tx.mpesaTransaction.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: txnId },
    }),
    settings: await settingsFor(tx, actor.schoolId),
  }));
  const creds = credentialsFrom(settings);
  const driver = darajaDriver(creds.environment);
  const urls = callbackUrls(token);
  try {
    if (row.kind === "stk") {
      const q = await driver.stkQuery(creds, row.checkoutRequestId!);
      if (q.resultCode === "0") return postConfirmed(db, actor, txnId, null);
      await markFailed(db, actor, txnId, `Safaricom STK check: ${q.resultDesc}`);
      return "verification_failed";
    }
    const result = await driver.checkTransaction(creds, {
      transId: row.transId!,
      resultUrl: urls.statusResult,
      timeoutUrl: urls.statusTimeout,
    });
    if (result.state === "verified") return postConfirmed(db, actor, txnId, result.amountCents);
    if (result.state === "not_found") {
      await withContext(db, ctxOf(actor), async (tx) => {
        await tx.mpesaTransaction.updateMany({
          where: {
            schoolId: actor.schoolId,
            id: txnId,
            status: { in: ["pending_verification", "verification_failed"] },
          },
          data: {
            status: "rejected",
            statusDetail: `Safaricom did not confirm this payment: ${result.detail}. Not posted.`,
          },
        });
        await audit(tx, {
          schoolId: actor.schoolId,
          actorId: actor.userId,
          action: "fees.mpesa.rejected",
          targetType: "mpesa_transaction",
          targetId: txnId,
          after: { transId: row.transId, detail: result.detail },
        });
      });
      return "rejected";
    }
    return "pending";
  } catch (err) {
    await markFailed(
      db,
      actor,
      txnId,
      `Could not reach Safaricom to confirm: ${(err as Error).message}`,
    );
    return "verification_failed";
  }
}

async function markFailed(db: PrismaClient, actor: Actor, txnId: string, detail: string) {
  await withContext(db, ctxOf(actor), (tx) =>
    tx.mpesaTransaction.updateMany({
      where: {
        schoolId: actor.schoolId,
        id: txnId,
        status: { in: ["pending_verification", "verification_failed"] },
      },
      data: { status: "verification_failed", statusDetail: detail.slice(0, 300) },
    }),
  );
}

// ---------------------------------------------------------------------------
// Callbacks (public endpoints, see src/app/api/pay/[token]/...)
// ---------------------------------------------------------------------------

export const ACCEPTED = { ResultCode: "0", ResultDesc: "Accepted" };

type C2BBody = {
  TransactionType?: string;
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
};

/** C2B confirmation: record the transaction once, then confirm it with Safaricom. */
export async function handleC2BConfirmation(db: PrismaClient, token: string, body: C2BBody) {
  const schoolId = await schoolForToken(db, token);
  if (!schoolId) return { status: 404 as const };
  const actor = await systemActor(db, schoolId);
  const transId = clean(body.TransID)?.toUpperCase() ?? null;
  const amount = parseKesToCents(body.TransAmount);
  if (!transId || "error" in amount || !amount.cents || amount.cents <= 0) {
    return { status: 200 as const, body: ACCEPTED, outcome: "ignored" };
  }
  const created = await withContext(db, ctxOf(actor), async (tx) => {
    const existing = await tx.mpesaTransaction.findUnique({
      where: { schoolId_transId: { schoolId, transId } },
    });
    if (existing) return null; // duplicate callback (or the STK callback came first)
    const settings = await settingsFor(tx, schoolId);
    if (body.BusinessShortCode && String(body.BusinessShortCode) !== settings.shortcode)
      return null;
    return tx.mpesaTransaction.create({
      data: {
        schoolId,
        kind: "c2b",
        transId,
        amountCents: amount.cents!,
        msisdn: clean(body.MSISDN),
        billRef: clean(body.BillRefNumber),
        payerName:
          [body.FirstName, body.MiddleName, body.LastName].map(clean).filter(Boolean).join(" ") ||
          null,
        transTime: parseDarajaTime(body.TransTime),
        status: "pending_verification",
        raw: body as object,
      },
    });
  }).catch((err) => {
    // Two copies of the same callback at the same moment: the unique key stops the second.
    if (String(err).includes("Unique constraint")) return null;
    throw err;
  });
  if (!created) return { status: 200 as const, body: ACCEPTED, outcome: "duplicate" };
  const outcome = await verifyAndPost(db, actor, created.id, token);
  return { status: 200 as const, body: ACCEPTED, outcome };
}

/** C2B validation: accept everything (unknown accounts go to suspense, not back to the parent). */
export async function handleC2BValidation(db: PrismaClient, token: string) {
  const schoolId = await schoolForToken(db, token);
  if (!schoolId) return { status: 404 as const };
  return { status: 200 as const, body: { ResultCode: "0", ResultDesc: "Accepted" } };
}

type StatusResultBody = {
  Result?: {
    ResultCode?: number | string;
    ResultDesc?: string;
    TransactionID?: string;
    ResultParameters?: {
      ResultParameter?: { Key: string; Value?: unknown }[] | { Key: string; Value?: unknown };
    };
  };
};

/** Transaction status result (Daraja's answer to our confirmation query). */
export async function handleStatusResult(db: PrismaClient, token: string, body: StatusResultBody) {
  const schoolId = await schoolForToken(db, token);
  if (!schoolId) return { status: 404 as const };
  const actor = await systemActor(db, schoolId);
  const r = body.Result ?? {};
  const params = r.ResultParameters?.ResultParameter;
  const list = Array.isArray(params) ? params : params ? [params] : [];
  const get = (k: string) => list.find((p) => p.Key === k)?.Value;
  const transId = String(get("ReceiptNo") ?? r.TransactionID ?? "").toUpperCase();
  if (!transId) return { status: 200 as const, body: ACCEPTED, outcome: "ignored" };
  const row = await withContext(db, ctxOf(actor), (tx) =>
    tx.mpesaTransaction.findUnique({ where: { schoolId_transId: { schoolId, transId } } }),
  );
  if (!row) return { status: 200 as const, body: ACCEPTED, outcome: "unknown" };
  if (
    String(r.ResultCode) === "0" &&
    String(get("TransactionStatus") ?? "Completed") === "Completed"
  ) {
    const amount = parseKesToCents(get("Amount") as string | number | undefined);
    const cents = "error" in amount ? null : amount.cents;
    if (cents === null) {
      await markFailed(db, actor, row.id, "Safaricom's answer had no amount");
      return { status: 200 as const, body: ACCEPTED, outcome: "verification_failed" };
    }
    const outcome = await postConfirmed(db, actor, row.id, cents);
    return { status: 200 as const, body: ACCEPTED, outcome };
  }
  await markFailed(db, actor, row.id, `Safaricom: ${r.ResultDesc ?? "could not confirm"}`);
  return { status: 200 as const, body: ACCEPTED, outcome: "verification_failed" };
}

export async function handleStatusTimeout(db: PrismaClient, token: string) {
  const schoolId = await schoolForToken(db, token);
  if (!schoolId) return { status: 404 as const };
  return { status: 200 as const, body: ACCEPTED };
}

type StkBody = {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string | null;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name: string; Value?: unknown }[] };
    };
  };
};

/** STK Push result. */
export async function handleStkCallback(db: PrismaClient, token: string, body: StkBody) {
  const schoolId = await schoolForToken(db, token);
  if (!schoolId) return { status: 404 as const };
  const actor = await systemActor(db, schoolId);
  const cb = body.Body?.stkCallback;
  const checkoutRequestId = clean(cb?.CheckoutRequestID);
  if (!cb || !checkoutRequestId)
    return { status: 200 as const, body: ACCEPTED, outcome: "ignored" };
  const items = cb.CallbackMetadata?.Item ?? [];
  const item = (n: string) => items.find((i) => i.Name === n)?.Value;

  const next = await withContext(db, ctxOf(actor), async (tx) => {
    const row = await tx.mpesaTransaction.findUnique({
      where: { schoolId: actor.schoolId, checkoutRequestId },
    });
    if (!row || row.status !== "stk_requested") return { id: null, outcome: "duplicate" as const };
    if (String(cb.ResultCode) !== "0") {
      await tx.mpesaTransaction.update({
        where: { schoolId: actor.schoolId, id: row.id },
        data: { status: "failed", statusDetail: cb.ResultDesc ?? "Not paid", raw: body as object },
      });
      return { id: null, outcome: "failed" as const };
    }
    const transId = String(item("MpesaReceiptNumber") ?? "").toUpperCase();
    const amount = parseKesToCents(item("Amount") as string | number | undefined);
    const other = transId
      ? await tx.mpesaTransaction.findUnique({ where: { schoolId_transId: { schoolId, transId } } })
      : null;
    if (other) {
      // The Paybill's C2B confirmation for the same payment arrived first: it is the one posted.
      await tx.mpesaTransaction.update({
        where: { schoolId: actor.schoolId, id: row.id },
        data: {
          status: "merged",
          statusDetail: `Same payment as ${transId} (posted from the Paybill confirmation)`,
          raw: body as object,
        },
      });
      return { id: null, outcome: "duplicate" as const };
    }
    await tx.mpesaTransaction.update({
      where: { schoolId: actor.schoolId, id: row.id },
      data: {
        status: "pending_verification",
        transId: transId || null,
        amountCents: "error" in amount || !amount.cents ? row.amountCents : amount.cents,
        msisdn: item("PhoneNumber") ? String(item("PhoneNumber")) : row.msisdn,
        transTime: parseDarajaTime(item("TransactionDate")),
        raw: body as object,
      },
    });
    return { id: row.id, outcome: "pending" as const };
  });
  if (!next.id) return { status: 200 as const, body: ACCEPTED, outcome: next.outcome };
  const outcome = await verifyAndPost(db, actor, next.id, token);
  return { status: 200 as const, body: ACCEPTED, outcome };
}

// ---------------------------------------------------------------------------
// Staff actions: STK push, suspense, retry
// ---------------------------------------------------------------------------

export async function sendStkPush(
  { db }: Deps,
  actor: Actor,
  raw: { studentId: unknown; phone: unknown; amount: unknown },
) {
  assertCan(actor.permissions, "fees.collect");
  const phone = normalizePhone(String(raw.phone ?? ""));
  if (!phone || !phone.startsWith("+254"))
    throw new ValidationError("Enter a Kenyan M-Pesa number, like 0712 345 678.", "phone");
  const amount = Number(clean(raw.amount)?.replace(/,/g, ""));
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_STK_SHILLINGS) {
    throw new ValidationError(
      `Enter whole shillings from 1 to ${MAX_STK_SHILLINGS.toLocaleString("en-KE")}.`,
      "amount",
    );
  }
  const { settings, student } = await withContext(db, ctxOf(actor), async (tx) => ({
    settings: await tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } }),
    student: await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: String(raw.studentId ?? "") },
    }),
  }));
  if (!settings)
    throw new ValidationError(
      "M-Pesa is not set up yet. The Bursar can set it up under Fees → M-Pesa settings.",
    );
  if (!student) throw new ValidationError("Choose a student.", "studentId");
  const creds = credentialsFrom(settings);
  const urls = callbackUrls(decryptSecret(settings.callbackTokenEnc));
  const res = await darajaDriver(creds.environment).stkPush(creds, {
    phone: phone.slice(1),
    amountShillings: amount,
    accountReference: normaliseAccount(student.admissionNumber).slice(0, 12),
    description: "School fees",
    callbackUrl: urls.stk,
  });
  return withContext(db, ctxOf(actor), async (tx) => {
    const row = await tx.mpesaTransaction.create({
      data: {
        schoolId: actor.schoolId,
        kind: "stk",
        checkoutRequestId: res.checkoutRequestId,
        amountCents: amount * 100,
        msisdn: phone,
        billRef: student.admissionNumber,
        studentId: student.id,
        requestedById: actor.userId,
        status: "stk_requested",
        raw: { merchantRequestId: res.merchantRequestId },
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.mpesa.stk",
      targetType: "student",
      targetId: student.id,
      after: { phone, amountCents: amount * 100, checkoutRequestId: res.checkoutRequestId },
      ip: actor.ip,
    });
    return { id: row.id, message: res.customerMessage };
  });
}

export async function listMpesaTransactions({ db }: Deps, actor: Actor, statuses?: string[]) {
  assertCan(actor.permissions, "fees.collect");
  return withContext(db, ctxOf(actor), (tx) =>
    tx.mpesaTransaction.findMany({
      where: { schoolId: actor.schoolId, ...(statuses ? { status: { in: statuses } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
}

/** Bursar assigns a suspense payment to the right student: posts it and issues the receipt. */
export async function assignSuspense(
  { db }: Deps,
  actor: Actor,
  txnId: string,
  rawAdmission: unknown,
) {
  assertCan(actor.permissions, "fees.collect");
  const admission = clean(rawAdmission) ?? "";
  return withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId: actor.schoolId, admissionNumber: admission } },
    });
    if (!student)
      throw new ValidationError(`No student has admission number ${admission}.`, "admissionNumber");
    const claimed = await tx.mpesaTransaction.updateMany({
      where: { schoolId: actor.schoolId, id: txnId, status: "suspense" },
      data: { status: "posting" },
    });
    if (claimed.count === 0) throw new ValidationError("This payment is no longer in suspense.");
    const row = await tx.mpesaTransaction.findUniqueOrThrow({
      where: { schoolId: actor.schoolId, id: txnId },
    });
    const { payment, receipt } = await postPayment(tx, actor, {
      studentId: student.id,
      method: "mpesa",
      amountCents: row.amountCents!,
      reference: row.transId,
      payerName: row.payerName,
      payerPhone: row.msisdn ? normalizePhone(row.msisdn) : null,
      paidAt: row.transTime ?? row.createdAt,
      mpesaTransactionId: row.id,
    });
    await tx.mpesaTransaction.update({
      where: { schoolId: actor.schoolId, id: txnId },
      data: {
        status: "assigned",
        statusDetail: `Assigned to ${student.admissionNumber}`,
        studentId: student.id,
        paymentId: payment.id,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "fees.mpesa.assign",
      targetType: "mpesa_transaction",
      targetId: txnId,
      after: { transId: row.transId, studentId: student.id, billRef: row.billRef },
      ip: actor.ip,
    });
    return { receiptId: receipt.id };
  });
}

/** Ask Safaricom again for a payment whose confirmation failed or timed out. */
export async function retryVerification({ db }: Deps, actor: Actor, txnId: string) {
  assertCan(actor.permissions, "fees.collect");
  const settings = await withContext(db, ctxOf(actor), (tx) =>
    tx.mpesaSettings.findUnique({ where: { schoolId: actor.schoolId } }),
  );
  if (!settings) throw new ValidationError("M-Pesa is not set up.");
  const system = await systemActor(db, actor.schoolId);
  return verifyAndPost(db, system, txnId, decryptSecret(settings.callbackTokenEnc));
}
