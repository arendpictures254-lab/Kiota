import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { createOtpService } from "@/lib/auth/otp";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, type Tx } from "@/lib/db-core";
import { postEntry } from "@/lib/fees/ledger";
import { createDefaultVoteHeads } from "@/lib/fees/setup";
import { recordManualPayment } from "@/lib/fees/payments";
import {
  noticeReadCounts,
  parseInviteInput,
  parseNoticeInput,
  portalSignIns,
  previewInvite,
  sendInvite,
  sendNotice,
} from "@/lib/messaging/service";
import { adminCreditWallet } from "@/lib/messaging/wallet";
import { readSimStore, simTransId, writeSimStore } from "@/lib/mpesa/simulator";
import { handleStkCallback, normaliseAccount, saveMpesaSettings } from "@/lib/mpesa/service";
import { decryptSecret } from "@/lib/crypto";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  makeAdmin,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import {
  PortalCodeError,
  childFees,
  childNotices,
  confirmLink,
  declineLink,
  familyOverview,
  markNoticeRead,
  myChild,
  myChildren,
  paymentStatus,
  recordParentSignIn,
  requestConfirmCode,
  sections,
  setMyLanguage,
  startPayment,
} from "./service";

const deps = { db: app };
const perms = (role: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
    grants: [],
  });

// Sign-in codes: a fake SMS that remembers each code.
const codes = new Map<string, string>();
const otp = createOtpService({
  db: app,
  secret: "portal-test",
  sendSms: async ({ to, text }) => {
    codes.set(to, /(\d{6})/.exec(text)![1]);
  },
});

type SchoolFixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeFixture(label: string, shortcode: string) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  const stream = await makeStream(school.id, "Grade 7", "East");
  const actor = async (role: string): Promise<Actor> => {
    const m = await makeMember(school.id, [role], role);
    return { userId: m.user.id, schoolId: school.id, permissions: perms(role) };
  };
  const director = await actor("director");
  const bursar = await actor("bursar");
  await createDefaultVoteHeads(deps, bursar);
  await saveMpesaSettings(deps, bursar, {
    shortcode,
    shortcodeType: "paybill",
    environment: "simulator",
  });
  const settings = await owner.mpesaSettings.findUniqueOrThrow({ where: { schoolId: school.id } });
  return {
    school,
    stream,
    director,
    bursar,
    shortcode,
    token: decryptSecret(settings.callbackTokenEnc),
  };
}

async function parent(phone = randomPhone(), name = "Parent") {
  return owner.user.upsert({ where: { phone }, create: { phone, name }, update: {} });
}

async function child(
  f: SchoolFixture,
  parentId: string,
  opts: Partial<{
    pending: boolean;
    name: string;
    receivesFees: boolean;
    receivesAcademics: boolean;
    receivesBoarding: boolean;
    relationship: "mother" | "sponsor";
    language: "en" | "sw";
  }> = {},
) {
  const student = await makeStudent(f.school.id, f.stream.id, {
    firstName: opts.name ?? "Amani",
    lastName: "Otieno",
    admissionNumber: `AD/${Date.now() % 1_000_000}/${Math.floor(Math.random() * 1000)}`,
  });
  const link = await owner.guardianLink.create({
    data: {
      schoolId: f.school.id,
      studentId: student.id,
      userId: parentId,
      name: `Name at ${f.school.name}`,
      relationship: opts.relationship ?? "mother",
      language: opts.language ?? "en",
      receivesFees: opts.receivesFees ?? true,
      receivesAcademics: opts.receivesAcademics ?? true,
      receivesBoarding: opts.receivesBoarding ?? true,
    },
  });
  if (opts.pending) {
    await owner.parentLinkConfirmation.create({
      data: { guardianLinkId: link.id, userId: parentId, status: "pending" },
    });
  }
  return { student, link };
}

const canSignIn = async (phone: string) =>
  (await app.$queryRaw<{ ok: boolean }[]>`SELECT app_phone_can_sign_in(${phone}) AS ok`)[0].ok;

let A: SchoolFixture;
let B: SchoolFixture;

beforeAll(async () => {
  A = await makeFixture("Portal A", "600111");
  B = await makeFixture("Portal B", "600222");
  const admin = await makeAdmin();
  for (const f of [A, B]) {
    await adminCreditWallet(deps, { userId: admin.id, isPlatformAdmin: true }, f.school.id, {
      kind: "starter",
      amount: "500",
    });
  }
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("sign-in", () => {
  it("has no sign-up: an unknown number cannot get a code; a linked parent can", async () => {
    const stranger = randomPhone();
    expect(await canSignIn(stranger)).toBe(false);
    expect(await otp.requestCode(stranger)).toEqual({ ok: false, reason: "unknown_phone" });

    const p = await parent();
    expect(await canSignIn(p.phone)).toBe(false); // a user with no link and no school
    await child(A, p.id);
    expect(await canSignIn(p.phone)).toBe(true);
  });

  it("a parent whose only link was declined cannot sign in", async () => {
    const p = await parent();
    const { link } = await child(B, p.id, { pending: true });
    expect(await canSignIn(p.phone)).toBe(true); // to see the request
    await declineLink(deps, p.id, link.id);
    expect(await canSignIn(p.phone)).toBe(false);
  });
});

describe("one family, many schools", () => {
  it("hides a second school's child until the parent confirms with a fresh SMS code", async () => {
    const p = await parent();
    const a = await child(A, p.id, { name: "Brian" });
    const b = await child(B, p.id, { name: "Joy", pending: true });

    const before = await myChildren(deps, p.id);
    const joy = before.find((c) => c.linkId === b.link.id)!;
    expect(joy).toMatchObject({ pending: true, firstName: "Joy", schoolName: B.school.name });
    // Nothing else about the child before confirming.
    expect(joy).toMatchObject({
      studentId: null,
      lastName: null,
      admissionNumber: null,
      className: null,
    });
    expect(await myChild(deps, p.id, b.link.id)).toBeNull();
    expect(await childFees(deps, p.id, b.link.id)).toBeNull();
    expect(await childNotices(deps, p.id, b.link.id)).toEqual([]);
    expect(await myChild(deps, p.id, a.link.id)).not.toBeNull();

    // Confirming needs a fresh code: none was sent yet, and a wrong one is refused.
    await expect(confirmLink(deps, otp, p, b.link.id, "000000")).rejects.toBeInstanceOf(
      PortalCodeError,
    );
    await requestConfirmCode(deps, otp, p, b.link.id);
    const wrong = codes.get(p.phone) === "111111" ? "222222" : "111111";
    await expect(confirmLink(deps, otp, p, b.link.id, wrong)).rejects.toMatchObject({
      reason: "wrong_code",
    });
    await confirmLink(deps, otp, p, b.link.id, codes.get(p.phone)!);

    const now = await myChild(deps, p.id, b.link.id);
    expect(now).toMatchObject({ firstName: "Joy", lastName: "Otieno", schoolName: B.school.name });
    expect(await childFees(deps, p.id, b.link.id)).toMatchObject({ balanceCents: 0 });
  });

  it("declining tells that school's Director, and nothing about the other school", async () => {
    const p = await parent();
    await child(A, p.id, { name: "Brian" });
    const b = await child(B, p.id, { name: "Joy", pending: true });
    await declineLink(deps, p.id, b.link.id);

    expect((await myChildren(deps, p.id)).map((c) => c.firstName)).toEqual(["Brian"]);
    await expect(declineLink(deps, p.id, b.link.id)).rejects.toThrow(); // once only
    const notes = await owner.notification.findMany({ where: { schoolId: B.school.id } });
    const note = notes.find((n) => n.body.includes("Joy Otieno"))!;
    expect(note.title).toMatch(/declined/);
    expect(note.body).toContain(`Name at ${B.school.name}`); // the school's own name for them
    expect(note.body).not.toContain(A.school.name);
    expect(note.body).not.toMatch(/Brian/);
    const directorMembership = await owner.membership.findFirstOrThrow({
      where: { schoolId: B.school.id, userId: B.director.userId },
    });
    expect(note.membershipId).toBe(directorMembership.id);
  });

  it("School B learns nothing about the parent's link at School A", async () => {
    const p = await parent();
    const a = await child(A, p.id, { name: "Brian" });
    const b = await child(B, p.id, { name: "Joy", pending: true });
    const asB = scopedDb(app, { userId: B.director.userId, schoolId: B.school.id });
    const links = await asB.guardianLink.findMany({
      where: { schoolId: B.school.id, userId: p.id },
    });
    expect(links.map((l) => l.id)).toEqual([b.link.id]);
    // Even raw SQL from School B sees only School B's link and none of the confirmations.
    const raw = await asB.$queryRaw<{ id: string }[]>`
      SELECT id FROM guardian_links WHERE user_id = ${p.id}::uuid`;
    expect(raw.map((r) => r.id)).toEqual([b.link.id]);
    expect(await asB.$queryRaw`SELECT * FROM parent_link_confirmations`).toEqual([]);
    expect(raw.some((r) => r.id === a.link.id)).toBe(false);
    // The parent's own portal functions refuse a school's staff context.
    expect(await childFees({ db: app }, B.director.userId, a.link.id)).toBeNull();
  });

  it("adds up the family's balance and what needs attention", async () => {
    const p = await parent();
    const a = await child(A, p.id, { name: "Brian" });
    await child(B, p.id, { name: "Joy", pending: true });
    await postEntry(owner as unknown as Tx, {
      schoolId: A.school.id,
      studentId: a.student.id,
      type: "charge",
      description: "Balance from before Kiota",
      createdById: A.bursar.userId,
      lines: [{ voteHeadId: null, amountCents: 300_000 }],
    });
    const o = await familyOverview(deps, p.id);
    expect(o.totalBalanceCents).toBe(300_000);
    expect(o.attention.map((x) => x.kind).sort()).toEqual(["due", "pending"]);
    // No invoice this term: the whole balance is arrears from earlier terms, due now.
    expect(o.attention.find((x) => x.kind === "due")).toMatchObject({
      amountCents: 300_000,
      arrearsCents: 300_000,
    });
  });
});

describe("what a guardian may see", () => {
  it("a sponsor with fees only sees fees and nothing else", async () => {
    const s = await parent();
    const { link } = await child(A, s.id, {
      relationship: "sponsor",
      receivesAcademics: false,
      receivesBoarding: false,
    });
    const c = (await myChild(deps, s.id, link.id))!;
    expect(sections(c)).toEqual({
      fees: true,
      notices: false,
      reportCards: false,
      leaveOuts: false,
      pocketMoney: false,
    });
    expect(await childFees(deps, s.id, link.id)).not.toBeNull();
  });

  it("a guardian who does not receive fees cannot read them", async () => {
    const g = await parent();
    const { link } = await child(A, g.id, { receivesFees: false });
    expect(await childFees(deps, g.id, link.id)).toBeNull();
  });

  it("module sections appear only when the school switches them on", async () => {
    const g = await parent();
    const { link } = await child(A, g.id);
    expect(sections((await myChild(deps, g.id, link.id))!).reportCards).toBe(false);
    await owner.school.update({ where: { id: A.school.id }, data: { modules: ["academics"] } });
    expect(sections((await myChild(deps, g.id, link.id))!).reportCards).toBe(true);
    await owner.school.update({ where: { id: A.school.id }, data: { modules: [] } });
  });

  it("one parent can never see another family's child", async () => {
    const p = await parent();
    const q = await parent();
    const pc = await child(A, p.id);
    await child(A, q.id);
    expect(await myChild(deps, q.id, pc.link.id)).toBeNull();
    expect(await childFees(deps, q.id, pc.link.id)).toBeNull();
    expect(await childNotices(deps, q.id, pc.link.id)).toEqual([]);
    const [photo] = await scopedDb(app, { userId: q.id, schoolId: null }).$queryRaw<
      { k: string | null }[]
    >`SELECT app_parent_child_photo(${pc.link.id}::uuid) AS k`;
    expect(photo.k).toBeNull();
    await expect(
      startPayment(deps, q, pc.link.id, { amount: "100", phone: "0712345678" }),
    ).rejects.toThrow("not_found");
  });
});

describe("notices", () => {
  it("are in the inbox newest first, can be marked read, and the school sees read counts", async () => {
    const p = await parent();
    const q = await parent();
    const pc = await child(A, p.id);
    await child(A, q.id);
    const first = await sendNotice(
      deps,
      A.director,
      parseNoticeInput({ audience: `stream:${A.stream.id}`, message: "Sports day on Friday." }),
      null,
    );
    const second = await sendNotice(
      deps,
      A.director,
      parseNoticeInput({ audience: `stream:${A.stream.id}`, message: "Half term starts Monday." }),
      null,
    );
    const inbox = await childNotices(deps, p.id, pc.link.id);
    expect(inbox.slice(0, 2).map((n) => n.body)).toEqual([
      "Half term starts Monday.",
      "Sports day on Friday.",
    ]);
    expect(inbox.every((n) => n.readAt === null)).toBe(true);

    expect(await markNoticeRead(deps, p.id, first.campaignId)).toBe(true);
    expect(
      (await childNotices(deps, p.id, pc.link.id)).find((n) => n.id === first.campaignId)?.readAt,
    ).not.toBeNull();
    // A parent the notice was not sent to cannot mark it.
    const stranger = await parent();
    await child(B, stranger.id);
    expect(await markNoticeRead(deps, stranger.id, first.campaignId)).toBe(false);

    const counts = await noticeReadCounts(deps, A.director, [first.campaignId, second.campaignId]);
    expect(counts.get(first.campaignId)).toBe(1);
    expect(counts.get(second.campaignId) ?? 0).toBe(0);
    // School B never sees School A's read receipts.
    expect((await noticeReadCounts(deps, B.director, [first.campaignId])).size).toBe(0);
  });

  it("are shown in the guardian's language when the school wrote a Kiswahili version", async () => {
    const p = await parent();
    const pc = await child(A, p.id, { language: "sw" });
    await sendNotice(
      deps,
      A.director,
      parseNoticeInput({
        audience: `stream:${A.stream.id}`,
        message: "School closes on Friday.",
        messageSw: "Shule inafungwa Ijumaa.",
      }),
      null,
    );
    expect((await childNotices(deps, p.id, pc.link.id))[0].body).toBe("Shule inafungwa Ijumaa.");
  });
});

describe("paying from the portal", () => {
  it("sends the STK prompt to that child's school's Paybill with the admission number, then shows the receipt", async () => {
    const p = await parent();
    const b = await child(B, p.id, { name: "Joy" });
    await recordManualPayment(deps, B.bursar, {
      studentId: b.student.id,
      amountCents: 1_000,
      method: "cash",
      paidAt: new Date(),
      payerName: "Parent",
    } as never).catch(() => undefined);

    const { transactionId } = await startPayment(deps, p, b.link.id, {
      amount: "1,500",
      phone: "0711222333",
    });
    const row = await owner.mpesaTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    expect(row).toMatchObject({
      schoolId: B.school.id,
      studentId: b.student.id,
      portalUserId: p.id,
      amountCents: 150_000,
    });
    const stk = readSimStore().stk[row.checkoutRequestId!];
    expect(stk.shortcode).toBe(B.shortcode); // School B's Paybill, not School A's
    expect(stk.accountReference).toBe(normaliseAccount(b.student.admissionNumber).slice(0, 12));
    expect(stk.phone).toBe("254711222333");
    expect(await paymentStatus(deps, p.id, transactionId)).toEqual({ state: "waiting" });
    // Nobody else can follow it.
    const q = await parent();
    expect(await paymentStatus(deps, q.id, transactionId)).toEqual({ state: "unknown" });

    // The parent enters the PIN; Safaricom calls back and confirms.
    const transId = simTransId();
    const store = readSimStore();
    store.stk[row.checkoutRequestId!].status = "completed";
    store.stk[row.checkoutRequestId!].transId = transId;
    writeSimStore(store);
    await handleStkCallback(app, B.token, {
      Body: {
        stkCallback: {
          CheckoutRequestID: row.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "ok",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 1500 },
              { Name: "MpesaReceiptNumber", Value: transId },
              { Name: "PhoneNumber", Value: 254711222333 },
            ],
          },
        },
      },
    });
    const done = await paymentStatus(deps, p.id, transactionId);
    expect(done).toMatchObject({ state: "done", amountCents: 150_000 });
    const receipt = await owner.receipt.findFirstOrThrow({
      where: { schoolId: B.school.id, payment: { reference: transId } },
    });
    expect(done).toMatchObject({ receiptNumber: receipt.number, shareToken: receipt.shareToken });
    const fees = (await childFees(deps, p.id, b.link.id))!;
    expect(fees.payments[0]).toMatchObject({
      amountCents: 150_000,
      shareToken: receipt.shareToken,
    });
  });

  it("refuses a bad amount or phone, and a cancelled prompt shows as failed", async () => {
    const p = await parent();
    const a = await child(A, p.id);
    await expect(
      startPayment(deps, p, a.link.id, { amount: "0", phone: "0712345678" }),
    ).rejects.toMatchObject({ field: "amount" });
    await expect(
      startPayment(deps, p, a.link.id, { amount: "12.50", phone: "0712345678" }),
    ).rejects.toMatchObject({ field: "amount" });
    await expect(
      startPayment(deps, p, a.link.id, { amount: "100", phone: "12345" }),
    ).rejects.toMatchObject({ field: "phone" });
    const { transactionId } = await startPayment(deps, p, a.link.id, {
      amount: "100",
      phone: "0712345678",
    });
    const row = await owner.mpesaTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    await handleStkCallback(app, A.token, {
      Body: {
        stkCallback: {
          CheckoutRequestID: row.checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user",
        },
      },
    });
    expect(await paymentStatus(deps, p.id, transactionId)).toEqual({
      state: "failed",
      detail: "Request cancelled by user",
    });
  });
});

describe("language and sign-in records", () => {
  it("the parent's language applies to Kiota and to every school's messages to them", async () => {
    const p = await parent();
    const a = await child(A, p.id);
    const b = await child(B, p.id);
    await setMyLanguage(deps, p.id, "sw");
    const links = await owner.guardianLink.findMany({
      where: { id: { in: [a.link.id, b.link.id] } },
    });
    expect(links.every((l) => l.language === "sw")).toBe(true);
    const [me] = await scopedDb(app, { userId: p.id, schoolId: null }).$queryRaw<
      { preferred_language: string }[]
    >`SELECT * FROM app_me()`;
    expect(me.preferred_language).toBe("sw");
    await expect(setMyLanguage(deps, p.id, "fr")).rejects.toThrow();
  });

  it("each school sees which parents have signed in, but not pending links", async () => {
    const p = await parent();
    const a = await child(A, p.id);
    const b = await child(B, p.id, { pending: true });
    await recordParentSignIn(deps, p.id);
    const links = await owner.guardianLink.findMany({
      where: { id: { in: [a.link.id, b.link.id] } },
    });
    expect(links.find((l) => l.id === a.link.id)?.portalFirstSeenAt).not.toBeNull();
    expect(links.find((l) => l.id === b.link.id)?.portalFirstSeenAt).toBeNull();
  });
});

describe("inviting parents", () => {
  it("previews recipients and cost, sends in each guardian's language, and skips those signed in", async () => {
    const f = await makeFixture("Invite", "600333");
    const admin = await makeAdmin();
    await adminCreditWallet(deps, { userId: admin.id, isPlatformAdmin: true }, f.school.id, {
      kind: "starter",
      amount: "100",
    });
    const west = await makeStream(f.school.id, "Grade 7", "West");
    const en = await parent();
    const sw = await parent();
    const signedIn = await parent();
    const other = await parent();
    await child(f, en.id);
    await child(f, sw.id, { language: "sw" });
    await child(f, signedIn.id);
    const otherStudent = await makeStudent(f.school.id, west.id);
    await owner.guardianLink.create({
      data: {
        schoolId: f.school.id,
        studentId: otherStudent.id,
        userId: other.id,
        name: "West parent",
        relationship: "father",
      },
    });
    await recordParentSignIn(deps, signedIn.id);

    const input = parseInviteInput({ audience: `stream:${f.stream.id}`, onlyNew: "on" });
    const preview = await previewInvite(deps, f.director, input);
    expect(preview).toMatchObject({ recipients: 2, units: 2 });
    expect(preview.costCents).toBeGreaterThan(0);
    expect(preview.balanceAfterCents).toBe(preview.balanceCents - preview.costCents);

    await expect(sendInvite(deps, f.director, input, preview.costCents + 1)).rejects.toThrow(
      /cost changed/,
    );
    const sent = await sendInvite(deps, f.director, input, preview.costCents);
    expect(sent.recipients).toBe(2);
    const messages = await owner.message.findMany({ where: { campaignId: sent.campaignId } });
    expect(messages.map((m) => m.toPhone).sort()).toEqual([en.phone, sw.phone].sort());
    expect(messages.find((m) => m.toPhone === en.phone)?.body).toMatch(
      /now uses Kiota\. Sign in at .+ with this phone number/,
    );
    expect(messages.find((m) => m.toPhone === sw.phone)?.body).toMatch(/sasa inatumia Kiota/);

    const status = await portalSignIns(deps, f.director, `stream:${f.stream.id}`);
    expect(status).toMatchObject({ signedIn: 1, total: 3 });

    // Only those who may send messages invite parents (not the Bursar).
    await expect(previewInvite(deps, f.bursar, input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
