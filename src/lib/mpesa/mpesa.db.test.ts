import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { decryptSecret } from "@/lib/crypto";
import { scopedDb } from "@/lib/db-core";
import { createDefaultVoteHeads } from "@/lib/fees/setup";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
} from "../../../tests/db-helpers";
import { type DarajaDriver, setDarajaDriverForTests } from "./daraja";
import {
  assignSuspense,
  getMpesaSettings,
  handleC2BConfirmation,
  handleStatusResult,
  handleStkCallback,
  saveMpesaSettings,
  sendStkPush,
} from "./service";
import { readSimStore, simTransId, writeSimStore } from "./simulator";

const deps = { db: app };
const perms = (role: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
    grants: [],
  });

async function mpesaSchool(label: string, shortcode = "174379") {
  const school = await makeSchool(`${label} ${Date.now()}`);
  const stream = await makeStream(school.id, "Grade 7", "East");
  const b = await makeMember(school.id, ["bursar"]);
  const c = await makeMember(school.id, ["accounts_clerk"]);
  const bursar: Actor = { userId: b.user.id, schoolId: school.id, permissions: perms("bursar") };
  const clerk: Actor = {
    userId: c.user.id,
    schoolId: school.id,
    permissions: perms("accounts_clerk"),
  };
  await createDefaultVoteHeads(deps, bursar);
  await saveMpesaSettings(deps, bursar, {
    shortcode,
    shortcodeType: "paybill",
    environment: "simulator",
  });
  const settings = await owner.mpesaSettings.findUniqueOrThrow({ where: { schoolId: school.id } });
  const token = decryptSecret(settings.callbackTokenEnc);
  const student = await makeStudent(school.id, stream.id, {
    admissionNumber: `BA/2025/${Date.now() % 100000}`,
  });
  return { school, bursar, clerk, token, student, shortcode };
}

/** What Safaricom sends to the confirmation URL. */
function c2b(transId: string, amount: string, billRef: string, shortcode: string) {
  return {
    TransactionType: "Pay Bill",
    TransID: transId,
    TransTime: "20270115103045",
    TransAmount: amount,
    BusinessShortCode: shortcode,
    BillRefNumber: billRef,
    MSISDN: "254712345678",
    FirstName: "MARY",
    LastName: "OTIENO",
  };
}

/** Pretend Safaricom really received this payment (the simulator's record). */
function safaricomKnows(transId: string, amountCents: number, shortcode: string, billRef = "") {
  const store = readSimStore();
  store.transactions[transId] = {
    transId,
    amountCents,
    msisdn: "254712345678",
    billRef,
    shortcode,
    time: new Date().toISOString(),
  };
  writeSimStore(store);
}

afterEach(() => setDarajaDriverForTests(null));
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("M-Pesa settings", () => {
  it("encrypt credentials at rest and never show them back", async () => {
    const f = await mpesaSchool("Creds");
    await saveMpesaSettings(deps, f.bursar, {
      shortcode: "600999",
      shortcodeType: "paybill",
      environment: "sandbox",
      consumerKey: "my-consumer-key-123",
      consumerSecret: "my-consumer-secret-456",
      passkey: "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
      initiatorName: "testapi",
      securityCredential: "LONG-ENCRYPTED-CREDENTIAL==",
    });
    const raw = await owner.mpesaSettings.findUniqueOrThrow({ where: { schoolId: f.school.id } });
    expect(JSON.stringify(raw)).not.toContain("my-consumer-secret-456");
    expect(raw.consumerSecretEnc).toMatch(/^v1:/);
    expect(decryptSecret(raw.consumerSecretEnc!)).toBe("my-consumer-secret-456");
    const view = await getMpesaSettings(deps, f.bursar);
    expect(view).toMatchObject({
      hasConsumerSecret: true,
      hasPasskey: true,
      environment: "sandbox",
    });
    expect(JSON.stringify(view)).not.toContain("my-consumer");
    expect(view!.urls.confirmation).toMatch(/\/api\/pay\/[A-Za-z0-9_-]{20,}\/c2b\/confirm$/);
    // Clerks cannot read or change them.
    await expect(getMpesaSettings(deps, f.clerk)).rejects.toThrow(ForbiddenError);
    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId: f.school.id, action: "fees.mpesa.settings" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(log.after)).not.toContain("my-consumer");
  });
});

describe("C2B (Paybill) callbacks", () => {
  let f: Awaited<ReturnType<typeof mpesaSchool>>;
  beforeAll(async () => {
    f = await mpesaSchool("C2B");
  });

  it("post a confirmed payment to the student whose admission number was typed, with a receipt", async () => {
    const transId = simTransId();
    safaricomKnows(transId, 500_000, f.shortcode);
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    // Parents type it in many ways: case and symbols do not matter.
    const r = await handleC2BConfirmation(
      app,
      f.token,
      c2b(transId, "5000.00", ` ${adm.toLowerCase().replace(/\//g, "")} `, f.shortcode),
    );
    expect(r).toMatchObject({ status: 200, outcome: "posted", body: { ResultCode: "0" } });
    const payment = await owner.payment.findFirstOrThrow({
      where: { reference: transId },
      include: { receipt: true },
    });
    expect(payment).toMatchObject({
      studentId: f.student.id,
      method: "mpesa",
      amountCents: 500_000,
    });
    expect(payment.receipt?.number).toBeGreaterThan(0);
  });

  it("never create two payments from the same callback, even sent twice at once", async () => {
    const transId = simTransId();
    safaricomKnows(transId, 120_000, f.shortcode);
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    const body = c2b(transId, "1200", adm, f.shortcode);
    const results = await Promise.all([
      handleC2BConfirmation(app, f.token, body),
      handleC2BConfirmation(app, f.token, body),
      handleC2BConfirmation(app, f.token, body),
    ]);
    await handleC2BConfirmation(app, f.token, body);
    expect(results.filter((r) => "outcome" in r && r.outcome === "posted")).toHaveLength(1);
    expect(
      await owner.payment.count({ where: { schoolId: f.school.id, reference: transId } }),
    ).toBe(1);
    expect(await owner.mpesaTransaction.count({ where: { schoolId: f.school.id, transId } })).toBe(
      1,
    );
  });

  it("refuse a callback Safaricom cannot confirm (a forged payment)", async () => {
    const transId = simTransId(); // the simulator never made this payment
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    const r = await handleC2BConfirmation(app, f.token, c2b(transId, "99999", adm, f.shortcode));
    expect(r).toMatchObject({ outcome: "rejected" });
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(0);
    const row = await owner.mpesaTransaction.findFirstOrThrow({ where: { transId } });
    expect(row.status).toBe("rejected");
  });

  it("refuse an amount that differs from Safaricom's record", async () => {
    const transId = simTransId();
    safaricomKnows(transId, 10_000, f.shortcode); // KES 100 really paid
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    const r = await handleC2BConfirmation(app, f.token, c2b(transId, "100000", adm, f.shortcode));
    expect(r).toMatchObject({ outcome: "rejected" });
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(0);
  });

  it("ignore an unknown callback token", async () => {
    const r = await handleC2BConfirmation(
      app,
      "x".repeat(32),
      c2b(simTransId(), "100", "A", f.shortcode),
    );
    expect(r.status).toBe(404);
  });

  it("put unmatched payments in suspense for the Bursar to assign", async () => {
    const transId = simTransId();
    safaricomKnows(transId, 300_000, f.shortcode);
    const r = await handleC2BConfirmation(
      app,
      f.token,
      c2b(transId, "3000", "WRONG-NUMBER", f.shortcode),
    );
    expect(r).toMatchObject({ outcome: "suspense" });
    const row = await owner.mpesaTransaction.findFirstOrThrow({ where: { transId } });
    expect(row.statusDetail).toMatch(/No student with admission number "WRONG-NUMBER"/);
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(0);

    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    const { receiptId } = await assignSuspense(deps, f.clerk, row.id, adm);
    const receipt = await owner.receipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: { payment: true },
    });
    expect(receipt.payment).toMatchObject({
      studentId: f.student.id,
      amountCents: 300_000,
      reference: transId,
    });
    expect((await owner.mpesaTransaction.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "assigned",
    );
    await expect(assignSuspense(deps, f.clerk, row.id, adm)).rejects.toThrow(
      /no longer in suspense/,
    );
  });

  it("with real Daraja, wait for the status result before posting", async () => {
    const pending: DarajaDriver = {
      name: "pending",
      stkPush: async () => {
        throw new Error("unused");
      },
      stkQuery: async () => ({ resultCode: "0", resultDesc: "" }),
      checkTransaction: async () => ({ state: "pending" }),
      registerUrls: async () => {},
    };
    setDarajaDriverForTests(pending);
    const transId = simTransId();
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    expect(
      await handleC2BConfirmation(app, f.token, c2b(transId, "700", adm, f.shortcode)),
    ).toMatchObject({ outcome: "pending" });
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(0);
    const result = {
      Result: {
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        TransactionID: "OEI2AK4XXX",
        ResultParameters: {
          ResultParameter: [
            { Key: "ReceiptNo", Value: transId },
            { Key: "Amount", Value: 700 },
            { Key: "TransactionStatus", Value: "Completed" },
          ],
        },
      },
    };
    expect(await handleStatusResult(app, f.token, result)).toMatchObject({ outcome: "posted" });
    expect(await handleStatusResult(app, f.token, result)).toMatchObject({ outcome: null }); // already posted
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(1);
  });
});

describe("STK Push", () => {
  it("sends a prompt, then posts the payment to that student when Safaricom confirms", async () => {
    const f = await mpesaSchool("STK", "174380");
    const { id } = await sendStkPush(deps, f.clerk, {
      studentId: f.student.id,
      phone: "0712345678",
      amount: "2500",
    });
    const row = await owner.mpesaTransaction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      status: "stk_requested",
      amountCents: 250_000,
      studentId: f.student.id,
    });

    // The parent enters their PIN: the simulator completes it and calls back.
    const transId = simTransId();
    const store = readSimStore();
    store.stk[row.checkoutRequestId!].status = "completed";
    store.stk[row.checkoutRequestId!].transId = transId;
    writeSimStore(store);
    const callback = {
      Body: {
        stkCallback: {
          MerchantRequestID: "29115-34620561-1",
          CheckoutRequestID: row.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 2500 },
              { Name: "MpesaReceiptNumber", Value: transId },
              { Name: "TransactionDate", Value: 20270115103045 },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    };
    expect(await handleStkCallback(app, f.token, callback)).toMatchObject({ outcome: "posted" });
    expect(await handleStkCallback(app, f.token, callback)).toMatchObject({ outcome: "duplicate" });
    // Paybills also send a C2B confirmation for STK payments: it must not double-post.
    safaricomKnows(transId, 250_000, f.shortcode);
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: f.student.id } }))
      .admissionNumber;
    expect(
      await handleC2BConfirmation(app, f.token, c2b(transId, "2500", adm, f.shortcode)),
    ).toMatchObject({ outcome: "duplicate" });
    expect(await owner.payment.count({ where: { reference: transId } })).toBe(1);
  });

  it("records a cancelled prompt without a payment", async () => {
    const f = await mpesaSchool("STK cancel", "174381");
    const { id } = await sendStkPush(deps, f.bursar, {
      studentId: f.student.id,
      phone: "0712345678",
      amount: "100",
    });
    const row = await owner.mpesaTransaction.findUniqueOrThrow({ where: { id } });
    await handleStkCallback(app, f.token, {
      Body: {
        stkCallback: {
          CheckoutRequestID: row.checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user",
        },
      },
    });
    expect((await owner.mpesaTransaction.findUniqueOrThrow({ where: { id } })).status).toBe(
      "failed",
    );
    expect(await owner.payment.count({ where: { mpesaTransactionId: id } })).toBe(0);
  });
});

describe("school walls", () => {
  it("one school's callback token never posts into another school, and B cannot see A's M-Pesa", async () => {
    const a = await mpesaSchool("Wall A", "174382");
    const b = await mpesaSchool("Wall B", "174383");
    const transId = simTransId();
    safaricomKnows(transId, 100_000, a.shortcode);
    const admA = (await owner.student.findUniqueOrThrow({ where: { id: a.student.id } }))
      .admissionNumber;
    // Sent to B's URL with A's student's number: B has no such student -> B's suspense, not A.
    const r = await handleC2BConfirmation(app, b.token, c2b(transId, "1000", admA, b.shortcode));
    expect(r).toMatchObject({ outcome: "rejected" }); // Safaricom: not a payment to B's shortcode
    expect(await owner.payment.count({ where: { studentId: a.student.id } })).toBe(0);
    const dbB = scopedDb(app, { userId: b.bursar.userId, schoolId: b.school.id });
    expect(await dbB.mpesaTransaction.findMany({ where: { schoolId: a.school.id } })).toEqual([]);
    expect(await dbB.mpesaSettings.findMany({ where: { schoolId: a.school.id } })).toEqual([]);
  });
});
