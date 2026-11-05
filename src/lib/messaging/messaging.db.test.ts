import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { createOtpService } from "@/lib/auth/otp";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb } from "@/lib/db-core";
import { createDefaultVoteHeads } from "@/lib/fees/setup";
import { recordManualPayment } from "@/lib/fees/payments";
import { type DarajaDriver, setDarajaDriverForTests } from "@/lib/mpesa/daraja";
import type { Actor } from "@/lib/service-kit";
import { type SmsDriver, type SmsMessage, sendPlatformSms, setSmsDriverForTests } from "@/lib/sms";
import {
  type WhatsAppDriver,
  type WhatsAppTemplateMessage,
  setWhatsAppDriverForTests,
} from "@/lib/whatsapp";
import {
  app,
  makeAdmin,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
} from "../../../tests/db-helpers";
import { NotEnoughCreditError } from "./outbox";
import {
  CostChangedError,
  listMessages,
  parseNoticeInput,
  previewFeeReminders,
  previewNotice,
  sendFeeReminders,
  sendNotice,
} from "./service";
import {
  adminCreditWallet,
  adminSetWallet,
  handleTopupCallback,
  requestWalletTopup,
  setLowBalanceThreshold,
  walletOverview,
} from "./wallet";
import { MAX_ATTEMPTS, applyDeliveryReport, processDueMessages } from "./worker";

const deps = { db: app };
const perms = (role: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
    grants: [],
  });

// A Wednesday at 10:00 Nairobi: daytime, so nothing waits for quiet hours.
const DAY = new Date("2027-01-13T07:00:00Z");
let tick = 0;
/** A fresh moment each time (just after DAY) so messages sort and are due in order. */
const daytime = () => new Date(DAY.getTime() + ++tick * 1000);
/** Process everything due now (the clock moves on past retries' back-off when asked). */
const run = (now = new Date(DAY.getTime() + ++tick * 1000 + 3600_000)) =>
  processDueMessages(app, { now });

// ---- Fake providers ---------------------------------------------------------

let sms: (SmsMessage & { id: string })[] = [];
let smsBehaviour: (m: SmsMessage) => Awaited<ReturnType<SmsDriver["send"]>> | null = () => null;
const fakeSms: SmsDriver = {
  name: "test-sms",
  async send(m) {
    const id = `test-${Math.random().toString(36).slice(2)}`;
    const special = smsBehaviour(m);
    if (special) return special;
    sms.push({ ...m, id });
    return { ok: true, provider: "test-sms", providerMessageId: id };
  },
};

let wa: (WhatsAppTemplateMessage & { id: string })[] = [];
let waBehaviour: (
  m: WhatsAppTemplateMessage,
) => Awaited<ReturnType<WhatsAppDriver["send"]>> | null = () => null;
const fakeWa: WhatsAppDriver = {
  name: "test-wa",
  async send(m) {
    const id = `wamid-${Math.random().toString(36).slice(2)}`;
    const special = waBehaviour(m);
    if (special) return special;
    wa.push({ ...m, id });
    return { ok: true, provider: "test-wa", providerMessageId: id };
  },
};

const smsTo = (phone: string) => sms.filter((m) => m.to === phone);

// ---- Fixtures -----------------------------------------------------------------

type School = Awaited<ReturnType<typeof makeFixture>>;

let phoneSeq = 0;
const uniquePhone = () =>
  `+2547${String(Date.now() % 1_000_000).padStart(6, "0")}${String(phoneSeq++ % 100).padStart(2, "0")}`;

async function guardian(
  schoolId: string,
  studentId: string,
  opts: Partial<{
    language: "en" | "sw";
    receivesFees: boolean;
    receivesAcademics: boolean;
    receivesBoarding: boolean;
    whatsapp: boolean;
    relationship: "mother" | "father" | "sponsor";
    phone: string;
  }> = {},
) {
  const phone = opts.phone ?? uniquePhone();
  const user = await owner.user.upsert({
    where: { phone },
    create: { phone, name: "Parent" },
    update: {},
  });
  await owner.guardianLink.create({
    data: {
      schoolId,
      studentId,
      userId: user.id,
      name: `Parent ${phone.slice(-4)}`,
      relationship: opts.relationship ?? "mother",
      language: opts.language ?? "en",
      receivesFees: opts.receivesFees ?? true,
      receivesAcademics: opts.receivesAcademics ?? true,
      receivesBoarding: opts.receivesBoarding ?? true,
      whatsapp: opts.whatsapp ?? false,
    },
  });
  return phone;
}

async function makeFixture(label: string, creditKes = 1000) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  const east = await makeStream(school.id, "Grade 7", "East");
  const west = await makeStream(school.id, "Grade 7", "West");
  const actor = async (role: string): Promise<Actor> => {
    const m = await makeMember(school.id, [role], role);
    return { userId: m.user.id, schoolId: school.id, permissions: perms(role) };
  };
  const director = await actor("director");
  const bursar = await actor("bursar");
  const clerk = await actor("accounts_clerk");
  const principal = await actor("principal");
  const teacherMember = await makeMember(school.id, ["class_teacher"], "Teacher");
  await owner.stream.update({
    where: { id: east.id },
    data: { classTeacherMembershipId: teacherMember.membership.id },
  });
  const teacher: Actor = {
    userId: teacherMember.user.id,
    schoolId: school.id,
    permissions: perms("class_teacher"),
  };
  await createDefaultVoteHeads(deps, bursar);
  const eastStudent = await makeStudent(school.id, east.id, {
    firstName: "Amina",
    lastName: "Wanjiru",
  });
  const westStudent = await makeStudent(school.id, west.id, {
    firstName: "Baraka",
    lastName: "Otieno",
  });
  const eastParent = await guardian(school.id, eastStudent.id);
  const westParent = await guardian(school.id, westStudent.id, { language: "sw" });
  if (creditKes > 0) {
    await adminCreditWallet(deps, admin, school.id, { kind: "starter", amount: String(creditKes) });
  }
  return {
    school,
    east,
    west,
    director,
    bursar,
    clerk,
    principal,
    teacher,
    eastStudent,
    westStudent,
    eastParent,
    westParent,
  };
}

const balanceOf = async (schoolId: string) =>
  Number(
    (await owner.walletEntry.aggregate({ where: { schoolId }, _sum: { amountCents: true } }))._sum
      .amountCents ?? 0,
  );

const notice = (over: Record<string, unknown> = {}) =>
  parseNoticeInput({
    audience: "school",
    topic: "general",
    channel: "sms",
    message: "School opens on Monday at 8am.",
    ...over,
  });

let admin: { userId: string; isPlatformAdmin: boolean };
let A: School;
let B: School;

beforeAll(async () => {
  const a = await makeAdmin();
  admin = { userId: a.id, isPlatformAdmin: true };
  A = await makeFixture("Msg A");
  B = await makeFixture("Msg B");
  // WhatsApp templates are "not_submitted" until Meta approves them: approve two for these tests.
  await owner.messageTemplate.updateMany({
    where: { key: { in: ["notice", "payment_received"] } },
    data: { whatsappStatus: "approved" },
  });
});

beforeEach(() => {
  sms = [];
  wa = [];
  smsBehaviour = () => null;
  waBehaviour = () => null;
  setSmsDriverForTests(fakeSms);
  setWhatsAppDriverForTests(fakeWa);
});

afterEach(() => {
  setSmsDriverForTests(null);
  setWhatsAppDriverForTests(undefined);
  setDarajaDriverForTests(null);
});

afterAll(async () => {
  await owner.messageTemplate.updateMany({ data: { whatsappStatus: "not_submitted" } });
  await app.$disconnect();
  await owner.$disconnect();
});

// ---------------------------------------------------------------------------

describe("the wallet: reserve, settle, refund", () => {
  it("reserves the cost when queued, keeps it when delivered and refunds a failed message", async () => {
    const f = await makeFixture("Reserve");
    const before = await balanceOf(f.school.id);
    expect(before).toBe(100_000); // KES 1,000 starter credit

    const preview = await previewNotice(deps, f.director, notice(), DAY);
    expect(preview).toMatchObject({
      recipients: 2,
      sms: 2,
      units: 2,
      costCents: 200,
      enough: true,
    });
    expect(preview.balanceAfterCents).toBe(before - 200);

    await sendNotice(deps, f.director, notice(), 200, daytime());
    // Reserved at once, before anything is sent.
    expect(await balanceOf(f.school.id)).toBe(before - 200);
    const reserves = await owner.walletEntry.findMany({
      where: { schoolId: f.school.id, type: "reserve" },
    });
    expect(reserves.map((r) => r.amountCents)).toEqual([-100, -100]);

    await run();
    expect(smsTo(f.eastParent)).toHaveLength(1);
    expect(smsTo(f.westParent)).toHaveLength(1);
    const east = smsTo(f.eastParent)[0];
    const west = smsTo(f.westParent)[0];

    // Delivered: settled, nothing changes. Failed: refunded, once, however many reports arrive.
    expect(
      await applyDeliveryReport(app, {
        provider: "test-sms",
        providerMessageId: east.id,
        outcome: "delivered",
      }),
    ).toBe("delivered");
    expect(
      await applyDeliveryReport(app, {
        provider: "test-sms",
        providerMessageId: west.id,
        outcome: "failed",
        error: "AbsentSubscriber",
      }),
    ).toBe("failed");
    expect(
      await applyDeliveryReport(app, {
        provider: "test-sms",
        providerMessageId: west.id,
        outcome: "failed",
      }),
    ).toBe("ignored");
    expect(await balanceOf(f.school.id)).toBe(before - 100);

    const rows = await owner.message.findMany({
      where: { schoolId: f.school.id },
      orderBy: { toPhone: "asc" },
    });
    expect(rows.find((m) => m.toPhone === f.eastParent)?.status).toBe("delivered");
    expect(rows.find((m) => m.toPhone === f.westParent)).toMatchObject({
      status: "failed",
      error: "AbsentSubscriber",
    });
    const log = await listMessages(deps, f.director, {});
    expect(log.find((m) => m.to === f.westParent)?.costCents).toBe(0);
    expect(log.find((m) => m.to === f.eastParent)?.costCents).toBe(100);
  });

  it("settles to the units the provider counted", async () => {
    const f = await makeFixture("Settle");
    smsBehaviour = (m) =>
      m.to === f.eastParent
        ? { ok: true, provider: "test-sms", providerMessageId: `units-${Date.now()}`, units: 3 }
        : null;
    await sendNotice(deps, f.director, notice(), 200, daytime());
    await run();
    // Reserved 1 unit for the East parent, the provider billed 3: two more units are taken.
    expect(await balanceOf(f.school.id)).toBe(100_000 - 200 - 200);
    const adj = await owner.walletEntry.findMany({
      where: { schoolId: f.school.id, type: "adjustment" },
    });
    expect(adj.map((a) => a.amountCents)).toEqual([-200]);
  });

  it("retries network failures with back-off, then fails and refunds", async () => {
    const f = await makeFixture("Retry");
    smsBehaviour = (m) =>
      m.to === f.eastParent
        ? { ok: false, provider: "test-sms", error: "timeout", retryable: true }
        : null;
    await sendNotice(deps, f.director, notice({ audience: `stream:${f.east.id}` }), 100, daytime());
    let clock = DAY.getTime() + 7200_000;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await processDueMessages(app, { now: new Date((clock += 3600_000)) });
      const m = await owner.message.findFirstOrThrow({ where: { schoolId: f.school.id } });
      expect(m).toMatchObject({ status: "queued", attempts: i, error: "timeout" });
      expect(m.nextAttemptAt.getTime()).toBeGreaterThan(clock);
    }
    await processDueMessages(app, { now: new Date((clock += 3600_000)) });
    const m = await owner.message.findFirstOrThrow({ where: { schoolId: f.school.id } });
    expect(m).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await balanceOf(f.school.id)).toBe(100_000);
  });

  it("is append-only: the app can never change or delete a wallet entry", async () => {
    const db = scopedDb(app, { userId: A.director.userId, schoolId: A.school.id });
    await expect(db.walletEntry.updateMany({ data: { amountCents: 999_999 } })).rejects.toThrow();
    await expect(db.walletEntry.deleteMany({})).rejects.toThrow();
    // Prices and overdraft are Arend Studio's to set, never the school's.
    await expect(
      db.$executeRaw`UPDATE wallets SET sms_unit_price_cents = 0, overdraft_limit_cents = 99999999`,
    ).rejects.toThrow(/permission denied/);
  });
});

describe("an empty wallet", () => {
  it("refuses a normal send, allows an emergency within the overdraft, and refuses beyond it", async () => {
    const f = await makeFixture("Empty", 0);
    await adminSetWallet(deps, admin, f.school.id, {
      smsPrice: "1",
      whatsappPrice: "1.50",
      overdraft: "1.50",
      senderId: "",
    });
    expect(await balanceOf(f.school.id)).toBe(0);

    const p = await previewNotice(deps, f.director, notice(), DAY);
    expect(p.enough).toBe(false);
    await expect(
      sendNotice(deps, f.director, notice(), p.costCents, daytime()),
    ).rejects.toBeInstanceOf(NotEnoughCreditError);

    // Critical, to one stream (KES 1): fits the KES 1.50 overdraft.
    const sos = notice({
      audience: `stream:${f.east.id}`,
      critical: "on",
      message: "Emergency: school closes at noon.",
    });
    await sendNotice(deps, f.director, sos, 100, daytime());
    expect(await balanceOf(f.school.id)).toBe(-100);
    // Another KES 1 would take it to -2.00: beyond the overdraft.
    await expect(sendNotice(deps, f.director, sos, 100, daytime())).rejects.toBeInstanceOf(
      NotEnoughCreditError,
    );
    await run();
    expect(smsTo(f.eastParent)[0].text).toContain("Emergency: school closes at noon.");
  });

  it("records automatic payment messages as not sent, at no cost", async () => {
    const f = await makeFixture("EmptyPay", 0);
    await recordManualPayment(deps, f.bursar, {
      studentId: f.eastStudent.id,
      method: "cash",
      amountCents: 500_000,
      reference: null,
      payerName: "Mary",
      payerPhone: null,
      paidAt: new Date(),
    });
    const [m] = await owner.message.findMany({ where: { schoolId: f.school.id } });
    expect(m).toMatchObject({ status: "failed", costCents: 0, templateKey: "payment_received" });
    expect(m.error).toMatch(/wallet is empty/);
    expect(await balanceOf(f.school.id)).toBe(0);
  });
});

describe("platform messages", () => {
  it("sign-in codes never touch a school's wallet or message log", async () => {
    const entriesBefore = await owner.walletEntry.count({ where: { schoolId: A.school.id } });
    const messagesBefore = await owner.message.count({ where: { schoolId: A.school.id } });
    const phone = (await owner.user.findUniqueOrThrow({ where: { id: A.director.userId } })).phone;
    const otp = createOtpService({ db: app, secret: "test-secret", sendSms: sendPlatformSms });
    expect(await otp.requestCode(phone)).toEqual({ ok: true });
    expect(smsTo(phone)).toHaveLength(1);
    expect(smsTo(phone)[0].text).toMatch(/sign-in code is \d{6}/);
    expect(await owner.walletEntry.count({ where: { schoolId: A.school.id } })).toBe(entriesBefore);
    expect(await owner.message.count({ where: { schoolId: A.school.id } })).toBe(messagesBefore);
  });
});

describe("quiet hours", () => {
  it("holds a notice queued at 22:00 until 07:00, but sends an emergency at once", async () => {
    const f = await makeFixture("Quiet");
    const night = new Date("2027-01-13T19:00:00Z"); // 22:00 Nairobi
    const p = await previewNotice(
      deps,
      f.director,
      notice({ audience: `stream:${f.east.id}` }),
      night,
    );
    expect(p.waitsForMorning).toBe(true);
    await sendNotice(deps, f.director, notice({ audience: `stream:${f.east.id}` }), 100, night);
    const queued = await owner.message.findFirstOrThrow({ where: { schoolId: f.school.id } });
    expect(queued.nextAttemptAt.toISOString()).toBe("2027-01-14T04:00:00.000Z"); // 07:00 Nairobi

    await processDueMessages(app, { now: new Date("2027-01-13T20:00:00Z") }); // 23:00
    expect(smsTo(f.eastParent)).toHaveLength(0);

    const sos = notice({
      audience: `stream:${f.west.id}`,
      critical: "on",
      message: "Emergency drill now.",
    });
    await sendNotice(deps, f.director, sos, 100, night);
    await processDueMessages(app, { now: new Date("2027-01-13T20:00:00Z") });
    expect(smsTo(f.westParent)).toHaveLength(1);
    expect(smsTo(f.eastParent)).toHaveLength(0);

    await processDueMessages(app, { now: new Date("2027-01-14T04:01:00Z") }); // 07:01
    expect(smsTo(f.eastParent)).toHaveLength(1);
  });
});

describe("guardian settings and language", () => {
  it("sends only the topics a guardian chose, in their language, once per phone", async () => {
    const f = await makeFixture("Prefs");
    const sponsor = await guardian(f.school.id, f.eastStudent.id, {
      relationship: "sponsor",
      receivesAcademics: false,
      receivesBoarding: false,
    });
    // The East parent is also a guardian of the West student: one notice, not two.
    await guardian(f.school.id, f.westStudent.id, { phone: f.eastParent });

    const msg = notice({
      message: "Half-term starts Friday.",
      messageSw: "Likizo fupi inaanza Ijumaa.",
    });
    const p = await previewNotice(deps, f.director, msg, DAY);
    expect(p.recipients).toBe(2); // not the fee-only sponsor; the shared parent once
    await sendNotice(deps, f.director, msg, p.costCents, daytime());
    await run();
    expect(smsTo(sponsor)).toHaveLength(0);
    expect(smsTo(f.eastParent).map((m) => m.text)).toEqual([
      `${f.school.name}: Half-term starts Friday.`,
    ]);
    expect(smsTo(f.westParent).map((m) => m.text)).toEqual([
      `${f.school.name}: Likizo fupi inaanza Ijumaa.`,
    ]);

    // Fees go to the sponsor too; a guardian who switched fees off gets nothing.
    await owner.guardianLink.updateMany({
      where: { studentId: f.westStudent.id, user: { phone: f.westParent } },
      data: { receivesFees: false },
    });
    sms = [];
    await recordManualPayment(deps, f.bursar, {
      studentId: f.eastStudent.id,
      method: "cash",
      amountCents: 250_000,
      reference: null,
      payerName: "Mary",
      payerPhone: null,
      paidAt: new Date(),
    });
    await recordManualPayment(deps, f.bursar, {
      studentId: f.westStudent.id,
      method: "cash",
      amountCents: 100_000,
      reference: null,
      payerName: "Mary",
      payerPhone: null,
      paidAt: new Date(),
    });
    await run();
    expect(smsTo(sponsor)).toHaveLength(1);
    expect(smsTo(sponsor)[0].text).toMatch(
      /KES 2,500 received for Amina W\. .*Receipt \d{6}: .*\/r\/[A-Z2-9]{16}/,
    );
    expect(smsTo(f.westParent)).toHaveLength(0);
    expect(smsTo(f.eastParent).some((m) => m.text.includes("Baraka O."))).toBe(true);
  });

  it("uses the Kiswahili template for a Kiswahili guardian", async () => {
    const f = await makeFixture("Swahili");
    await recordManualPayment(deps, f.bursar, {
      studentId: f.westStudent.id,
      method: "cash",
      amountCents: 120_000,
      reference: null,
      payerName: "Juma",
      payerPhone: null,
      paidAt: new Date(),
    });
    await run();
    expect(smsTo(f.westParent)[0].text).toMatch(/^.*: Tumepokea KES 1,200 kwa ajili ya Baraka O\./);
    expect(smsTo(f.westParent)[0].text).toMatch(/Ziada KES 1,200\./); // nothing invoiced: all credit
  });
});

describe("WhatsApp", () => {
  it("goes by SMS to a guardian without WhatsApp, and to everyone when a template is not approved", async () => {
    const f = await makeFixture("WaNo");
    const waParent = await guardian(f.school.id, f.westStudent.id, { whatsapp: true });
    await sendNotice(
      deps,
      f.director,
      notice({ channel: "whatsapp" }),
      (await previewNotice(deps, f.director, notice({ channel: "whatsapp" }), DAY)).costCents,
      daytime(),
    );
    await run();
    expect(wa.map((m) => m.to)).toEqual([waParent]);
    expect(wa[0]).toMatchObject({
      template: "kiota_notice",
      params: [f.school.name, "School opens on Monday at 8am."],
    });
    expect(smsTo(f.eastParent)).toHaveLength(1);
    expect(smsTo(waParent)).toHaveLength(0);

    await owner.messageTemplate.updateMany({
      where: { key: "notice" },
      data: { whatsappStatus: "pending" },
    });
    try {
      wa = [];
      sms = [];
      const p = await previewNotice(deps, f.director, notice({ channel: "whatsapp" }), DAY);
      expect(p.whatsapp).toBe(0);
      await sendNotice(deps, f.director, notice({ channel: "whatsapp" }), p.costCents, daytime());
      await run();
      expect(wa).toHaveLength(0);
      expect(smsTo(waParent)).toHaveLength(1);
    } finally {
      await owner.messageTemplate.updateMany({
        where: { key: "notice" },
        data: { whatsappStatus: "approved" },
      });
    }
  });

  it("falls back to SMS when WhatsApp delivery fails, refunding the WhatsApp message", async () => {
    const f = await makeFixture("WaFail");
    const waParent = await guardian(f.school.id, f.westStudent.id, { whatsapp: true });
    const lateFail = await guardian(f.school.id, f.westStudent.id, { whatsapp: true });
    waBehaviour = (m) =>
      m.to === waParent
        ? {
            ok: false,
            provider: "test-wa",
            error: "Message undeliverable (131026)",
            retryable: false,
          }
        : null;
    const msg = notice({ channel: "whatsapp", audience: `stream:${f.west.id}` });
    const p = await previewNotice(deps, f.director, msg, DAY);
    expect(p).toMatchObject({ whatsapp: 2, sms: 1 });
    await sendNotice(deps, f.director, msg, p.costCents, daytime());
    await run(); // WhatsApp refused at once for waParent -> SMS queued
    await run(); // ...and sent
    expect(smsTo(waParent)).toHaveLength(1);

    // The other one is accepted, then reported failed by the webhook: SMS too.
    const sent = wa.find((m) => m.to === lateFail)!;
    expect(
      await applyDeliveryReport(app, {
        provider: "test-wa",
        providerMessageId: sent.id,
        outcome: "failed",
        error: "Not on WhatsApp",
      }),
    ).toBe("failed");
    await run();
    expect(smsTo(lateFail)).toHaveLength(1);

    const rows = await owner.message.findMany({ where: { schoolId: f.school.id } });
    const failedWa = rows.filter((r) => r.channel === "whatsapp" && r.status === "failed");
    expect(failedWa).toHaveLength(2);
    expect(
      rows.filter((r) => r.fallbackOfId && failedWa.some((w) => w.id === r.fallbackOfId)),
    ).toHaveLength(2);
    // Net cost: three SMS (KES 1 each). Both WhatsApp messages were refunded.
    expect(await balanceOf(f.school.id)).toBe(100_000 - 300);
  });

  it("sends the receipt PDF on WhatsApp as well as the SMS", async () => {
    const f = await makeFixture("WaReceipt");
    const waParent = await guardian(f.school.id, f.eastStudent.id, { whatsapp: true });
    await recordManualPayment(deps, f.bursar, {
      studentId: f.eastStudent.id,
      method: "cash",
      amountCents: 300_000,
      reference: null,
      payerName: "Mary",
      payerPhone: null,
      paidAt: new Date(),
    });
    await run();
    expect(smsTo(waParent)).toHaveLength(1);
    expect(wa.filter((m) => m.to === waParent)).toHaveLength(1);
    expect(wa.find((m) => m.to === waParent)!.document?.url).toMatch(/\/r\/[A-Z2-9]{16}\/pdf$/);
  });
});

describe("fee reminders", () => {
  it("go to fee contacts with the balance, and refuse a send whose cost changed", async () => {
    const f = await makeFixture("Remind");
    await owner.$executeRaw`SELECT 1`;
    // Give the East student a balance through an opening-balance style charge on the ledger.
    const head = await owner.voteHead.findFirstOrThrow({ where: { schoolId: f.school.id } });
    const entry = await owner.ledgerEntry.create({
      data: {
        schoolId: f.school.id,
        studentId: f.eastStudent.id,
        type: "charge",
        amountCents: 1_250_000,
        description: "Test charge",
        createdById: f.bursar.userId,
      },
    });
    await owner.ledgerLine.create({
      data: {
        schoolId: f.school.id,
        entryId: entry.id,
        studentId: f.eastStudent.id,
        voteHeadId: head.id,
        amountCents: 1_250_000,
      },
    });
    const ids = [f.eastStudent.id, f.westStudent.id];
    const p = await previewFeeReminders(deps, f.bursar, ids, DAY);
    expect(p).toMatchObject({ recipients: 1, students: 1 }); // West owes nothing
    await expect(
      sendFeeReminders(deps, f.bursar, ids, p.costCents + 100, daytime()),
    ).rejects.toBeInstanceOf(CostChangedError);
    await sendFeeReminders(deps, f.bursar, ids, p.costCents, daytime());
    await run();
    expect(smsTo(f.eastParent)[0].text).toMatch(/has a fee balance of KES 12,500\. .*Thank you\./);
    const audit = await owner.auditLog.findFirst({
      where: { schoolId: f.school.id, action: "messages.fee_reminder" },
    });
    expect(audit?.actorId).toBe(f.bursar.userId);
  });
});

describe("permissions", () => {
  it("only Director and Principal send notices; the Bursar sends fee reminders", async () => {
    await expect(previewNotice(deps, A.bursar, notice(), DAY)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(sendNotice(deps, A.clerk, notice(), 0, DAY)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(previewNotice(deps, A.principal, notice(), DAY)).resolves.toMatchObject({
      recipients: 2,
    });
    await expect(
      previewFeeReminders(deps, A.clerk, [A.eastStudent.id], DAY),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      previewFeeReminders(deps, A.teacher, [A.eastStudent.id], DAY),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only Director and Bursar top up or set the alert; only Arend admins set prices", async () => {
    await expect(setLowBalanceThreshold(deps, A.clerk, "500")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      requestWalletTopup(deps, A.principal, { amount: "100", phone: "0712345678" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setLowBalanceThreshold(deps, A.bursar, "750");
    expect(
      (await owner.wallet.findUniqueOrThrow({ where: { schoolId: A.school.id } }))
        .lowBalanceThresholdCents,
    ).toBe(75_000);

    const notAdmin = { userId: A.director.userId, isPlatformAdmin: false };
    await expect(
      adminSetWallet(deps, notAdmin, A.school.id, {
        smsPrice: "0",
        whatsappPrice: "0",
        overdraft: "0",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Calling the database function directly as a school member is refused too.
    const db = scopedDb(app, { userId: A.director.userId, schoolId: A.school.id });
    await expect(
      db.$executeRaw`SELECT app_admin_credit_wallet(${A.school.id}::uuid, 'starter', 999999, null, null, null)`,
    ).rejects.toThrow(/not allowed/);
  });

  it("the Director sees every message; a class teacher only messages about their stream", async () => {
    await sendNotice(deps, A.director, notice(), 200, daytime());
    const all = await listMessages(deps, A.director, {});
    expect(all.some((m) => m.to === A.eastParent)).toBe(true);
    expect(all.some((m) => m.to === A.westParent)).toBe(true);
    const mine = await listMessages(deps, A.teacher, {});
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((m) => m.student?.id === A.eastStudent.id)).toBe(true);
  });
});

describe("wallet top-ups by M-Pesa (Arend Studio's Paybill)", () => {
  const token = "test-wallet-callback-token-1234567890";
  beforeEach(() => {
    process.env.PLATFORM_MPESA_ENVIRONMENT = "simulator";
    process.env.PLATFORM_MPESA_SHORTCODE = "600100";
    process.env.PLATFORM_MPESA_CALLBACK_TOKEN = token;
  });
  afterEach(() => {
    delete process.env.PLATFORM_MPESA_ENVIRONMENT;
    delete process.env.PLATFORM_MPESA_SHORTCODE;
    delete process.env.PLATFORM_MPESA_CALLBACK_TOKEN;
  });

  function fakeDaraja(
    paid: boolean,
  ): DarajaDriver & { pushes: { shortcode: string; callbackUrl: string }[] } {
    const pushes: { shortcode: string; callbackUrl: string }[] = [];
    return {
      name: "fake",
      pushes,
      async stkPush(c, r) {
        pushes.push({ shortcode: c.shortcode, callbackUrl: r.callbackUrl });
        return {
          checkoutRequestId: `ws_CO_${Date.now()}${Math.random()}`,
          merchantRequestId: "m",
          customerMessage: "ok",
        };
      },
      async stkQuery() {
        return paid
          ? { resultCode: "0", resultDesc: "Paid" }
          : { resultCode: "1032", resultDesc: "Cancelled" };
      },
      async checkTransaction() {
        return { state: "pending" as const };
      },
      async registerUrls() {},
    };
  }

  const callback = (checkout: string, receipt: string, amount: number) => ({
    Body: {
      stkCallback: {
        CheckoutRequestID: checkout,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: amount },
            { Name: "MpesaReceiptNumber", Value: receipt },
            { Name: "PhoneNumber", Value: 254712345678 },
          ],
        },
      },
    },
  });

  it("credits the wallet once, however many callbacks arrive", async () => {
    const f = await makeFixture("Topup");
    const daraja = fakeDaraja(true);
    setDarajaDriverForTests(daraja);
    const { id } = await requestWalletTopup(deps, f.director, {
      amount: "500",
      phone: "0712345678",
    });
    expect(daraja.pushes[0]).toMatchObject({ shortcode: "600100" }); // Arend's Paybill, not the school's
    expect(daraja.pushes[0].callbackUrl).toMatch(new RegExp(`/api/pay/topup/${token}/stk$`));
    const row = await owner.walletTopup.findUniqueOrThrow({ where: { id } });

    const body = callback(row.checkoutRequestId!, `SL${Date.now() % 1e8}`, 500);
    const results = await Promise.all([
      handleTopupCallback(app, token, body),
      handleTopupCallback(app, token, body),
      handleTopupCallback(app, token, body),
    ]);
    expect(results.filter((r) => r.outcome === "completed")).toHaveLength(1);
    expect(await handleTopupCallback(app, token, body)).toMatchObject({ outcome: "duplicate" });

    const credits = await owner.walletEntry.findMany({
      where: { schoolId: f.school.id, type: "topup" },
    });
    expect(credits.map((c) => c.amountCents)).toEqual([50_000]);
    expect((await owner.walletTopup.findUniqueOrThrow({ where: { id } })).status).toBe("completed");
    const overview = await walletOverview(deps, f.director);
    expect(overview.balanceCents).toBe(150_000);
    expect(
      await owner.auditLog.count({ where: { schoolId: f.school.id, action: "wallet.topup" } }),
    ).toBe(1);
  });

  it("never credits a prompt Safaricom does not confirm, or a callback with the wrong token", async () => {
    const f = await makeFixture("TopupFake");
    setDarajaDriverForTests(fakeDaraja(false));
    const { id } = await requestWalletTopup(deps, f.bursar, { amount: "200", phone: "0712345678" });
    const row = await owner.walletTopup.findUniqueOrThrow({ where: { id } });
    const body = callback(row.checkoutRequestId!, `SL${Date.now() % 1e8}X`, 200);
    expect(await handleTopupCallback(app, "wrong-token-wrong-token-wrong", body)).toEqual({
      status: 404,
    });
    expect(await handleTopupCallback(app, token, body)).toMatchObject({
      outcome: "verification_failed",
    });
    expect(await owner.walletEntry.count({ where: { schoolId: f.school.id, type: "topup" } })).toBe(
      0,
    );
  });
});

describe("school walls", () => {
  it("School B cannot see School A's messages, campaigns, wallet or top-ups", async () => {
    await sendNotice(deps, A.director, notice(), 200, daytime());
    const b = scopedDb(app, { userId: B.director.userId, schoolId: B.school.id });
    expect(await b.message.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await b.messageCampaign.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await b.walletEntry.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await b.walletTopup.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await b.wallet.findUnique({ where: { schoolId: A.school.id } })).toBeNull();
    const raw = await b.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM messages WHERE school_id = ${A.school.id}::uuid`;
    expect(Number(raw[0].n)).toBe(0);
    // Asking for School A while signed in to School B sees nothing either.
    const forged = scopedDb(app, { userId: B.director.userId, schoolId: A.school.id });
    expect(await forged.message.findMany()).toEqual([]);
    expect(await forged.walletEntry.findMany()).toEqual([]);
    const listed = await listMessages(deps, B.director, {});
    expect(listed.every((m) => m.to !== A.eastParent)).toBe(true);
  });

  it("School B cannot spend from School A's wallet", async () => {
    const db = scopedDb(app, { userId: B.director.userId, schoolId: B.school.id });
    await expect(
      db.walletEntry.create({
        data: {
          schoolId: A.school.id,
          type: "topup",
          amountCents: 1_000_000,
          description: "steal",
        },
      }),
    ).rejects.toThrow();
  });
});
