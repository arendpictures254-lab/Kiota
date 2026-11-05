import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, withContext } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  appUnguarded,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import {
  addCharge,
  generateTermInvoices,
  postOpeningBalances,
  previewTermInvoices,
} from "./invoicing";
import { studentPosition } from "./ledger";
import { recordManualPayment, reversePayment } from "./payments";
import {
  addBursary,
  addSiblingDiscount,
  createDefaultVoteHeads,
  moveVoteHead,
  saveFeeStructure,
} from "./setup";

const deps = { db: app };
const perms = (role: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
    grants: [],
  });

async function feesSchool(label: string) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  const stream = await makeStream(school.id, "Grade 7", "East");
  const d = await makeMember(school.id, ["director"]);
  const b = await makeMember(school.id, ["bursar"]);
  const c = await makeMember(school.id, ["accounts_clerk"]);
  const director: Actor = {
    userId: d.user.id,
    schoolId: school.id,
    permissions: perms("director"),
  };
  const bursar: Actor = { userId: b.user.id, schoolId: school.id, permissions: perms("bursar") };
  const clerk: Actor = {
    userId: c.user.id,
    schoolId: school.id,
    permissions: perms("accounts_clerk"),
  };
  await createDefaultVoteHeads(deps, bursar);
  const year = await owner.academicYear.create({
    data: {
      schoolId: school.id,
      name: "2027",
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-12-31"),
    },
  });
  const term = await owner.term.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: "Term 1",
      startDate: new Date("2027-01-06"),
      endDate: new Date("2027-04-03"),
    },
  });
  const level = await owner.level.findFirstOrThrow({
    where: { schoolId: school.id, key: "junior" },
  });
  const items = await owner.feeItem.findMany({
    where: { schoolId: school.id },
    include: { voteHead: true },
  });
  const item = (vh: string) => items.find((i) => i.voteHead.name === vh)!.id;
  await saveFeeStructure(deps, bursar, {
    termId: term.id,
    levelId: level.id,
    appliesTo: "boarder",
    amounts: { [item("Tuition")]: "15000", [item("Boarding")]: "18000", [item("Exam")]: "1500" },
    installments: [
      { dueDate: "2027-01-15", percent: "50" },
      { dueDate: "2027-02-15", percent: "30" },
      { dueDate: "2027-03-15", percent: "20" },
    ],
  });
  const heads = await owner.voteHead.findMany({ where: { schoolId: school.id } });
  const vh = (name: string) => heads.find((h) => h.name === name)!.id;
  return { school, stream, term, director, bursar, clerk, vh };
}

async function boarder(schoolId: string, streamId: string, extra: { dob?: string } = {}) {
  const s = await makeStudent(schoolId, streamId);
  await owner.student.update({
    where: { id: s.id },
    data: { boarder: true, ...(extra.dob ? { dateOfBirth: new Date(extra.dob) } : {}) },
  });
  return s;
}

const pay = (
  actor: Actor,
  studentId: string,
  amount: string,
  method: "cash" | "bank" = "cash",
  reference: string | null = null,
) =>
  recordManualPayment(deps, actor, {
    studentId,
    method,
    amountCents: Math.round(Number(amount) * 100),
    reference,
    payerName: null,
    payerPhone: null,
    paidAt: new Date(),
  });

async function position(actor: Actor, studentId: string) {
  return withContext(app, { userId: actor.userId, schoolId: actor.schoolId }, (tx) =>
    studentPosition(tx, actor.schoolId, studentId),
  );
}

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("invoices and the ledger", () => {
  let f: Awaited<ReturnType<typeof feesSchool>>;
  let s1: { id: string };

  beforeAll(async () => {
    f = await feesSchool("Ledger");
    s1 = await boarder(f.school.id, f.stream.id);
  });

  it("previews, then generates term invoices once", async () => {
    const preview = await previewTermInvoices(deps, f.bursar, f.term.id);
    expect(preview.totals).toMatchObject({
      invoices: 1,
      grossCents: 3_450_000,
      netCents: 3_450_000,
    });
    expect(await owner.invoice.count({ where: { schoolId: f.school.id } })).toBe(0);
    await generateTermInvoices(deps, f.bursar, f.term.id);
    expect((await position(f.bursar, s1.id)).balanceCents).toBe(3_450_000);
    await expect(generateTermInvoices(deps, f.bursar, f.term.id)).rejects.toThrow(
      /no students left/,
    );
  });

  it("allocates payments to vote heads in the school's priority order", async () => {
    await pay(f.bursar, s1.id, "16000");
    const p = await position(f.bursar, s1.id);
    expect(p.byVoteHead.get(f.vh("Tuition"))).toBe(0); // priority 2: paid first
    expect(p.byVoteHead.get(f.vh("Boarding"))).toBe(1_700_000); // 18,000 - 1,000
    expect(p.byVoteHead.get(f.vh("Exam"))).toBe(150_000);
    expect(p.balanceCents).toBe(1_850_000);
  });

  it("follows a changed priority for later payments", async () => {
    await moveVoteHead(deps, f.bursar, f.vh("Exam"), "up");
    await moveVoteHead(deps, f.bursar, f.vh("Exam"), "up");
    await moveVoteHead(deps, f.bursar, f.vh("Exam"), "up");
    await moveVoteHead(deps, f.bursar, f.vh("Exam"), "up"); // now above Boarding
    await pay(f.bursar, s1.id, "1000");
    const p = await position(f.bursar, s1.id);
    expect(p.byVoteHead.get(f.vh("Exam"))).toBe(50_000);
    expect(p.byVoteHead.get(f.vh("Boarding"))).toBe(1_700_000);
  });

  it("keeps overpayments as credit and uses it for later charges", async () => {
    await pay(f.bursar, s1.id, "20000"); // owes 17,500 -> 2,500 credit
    let p = await position(f.bursar, s1.id);
    expect(p.balanceCents).toBe(-250_000);
    expect(p.unallocatedCreditCents).toBe(250_000);
    const s = await owner.student.findUniqueOrThrow({ where: { id: s1.id } });
    await addCharge(deps, f.bursar, {
      admissionNumber: s.admissionNumber,
      voteHeadId: f.vh("Activity"),
      amount: "1000",
      description: "Trip to Fort Jesus",
    });
    p = await position(f.bursar, s1.id);
    expect(p.balanceCents).toBe(-150_000);
    expect(p.byVoteHead.get(f.vh("Activity"))).toBe(0); // paid from credit
    expect(p.unallocatedCreditCents).toBe(150_000);
  });

  it("the balance is always the sum of the ledger", async () => {
    const [{ entries, lines }] = await owner.$queryRaw<{ entries: bigint; lines: bigint }[]>`
      SELECT (SELECT coalesce(sum(amount_cents),0) FROM ledger_entries WHERE student_id = ${s1.id}::uuid) AS entries,
             (SELECT coalesce(sum(amount_cents),0) FROM ledger_lines WHERE student_id = ${s1.id}::uuid) AS lines`;
    expect(Number(entries)).toBe(Number(lines));
    expect(Number(entries)).toBe((await position(f.bursar, s1.id)).balanceCents);
  });
});

describe("reversals", () => {
  it("restore the balance and the vote heads, record who and why, and notify the Director", async () => {
    const f = await feesSchool("Reverse");
    const s = await boarder(f.school.id, f.stream.id);
    await generateTermInvoices(deps, f.bursar, f.term.id);
    const { payment, receipt } = await pay(f.bursar, s.id, "20000", "bank", `SLIP-${Date.now()}`);
    expect((await position(f.bursar, s.id)).balanceCents).toBe(1_450_000);

    await reversePayment(deps, f.bursar, payment.id, "Bank slip belonged to another student");
    const p = await position(f.bursar, s.id);
    expect(p.balanceCents).toBe(3_450_000);
    expect(p.byVoteHead.get(f.vh("Tuition"))).toBe(1_500_000);
    expect(p.byVoteHead.get(f.vh("Boarding"))).toBe(1_800_000);

    const rev = await owner.reversal.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(rev).toMatchObject({
      reason: "Bank slip belonged to another student",
      reversedById: f.bursar.userId,
    });
    // The receipt still exists, unchanged.
    expect(await owner.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({
      number: receipt.number,
    });
    const directorMembership = await owner.membership.findFirstOrThrow({
      where: { userId: f.director.userId },
    });
    const note = await owner.notification.findFirstOrThrow({
      where: { membershipId: directorMembership.id },
    });
    expect(note.title).toMatch(/reversed/);
    expect(note.body).toMatch(/Bank slip belonged to another student/);

    await expect(reversePayment(deps, f.bursar, payment.id, "again please")).rejects.toThrow(
      /already been reversed/,
    );
  });

  it("an accounts clerk can record payments but cannot reverse them or change fee structures", async () => {
    const f = await feesSchool("Clerk");
    const s = await boarder(f.school.id, f.stream.id);
    const { payment } = await pay(f.clerk, s.id, "500");
    await expect(reversePayment(deps, f.clerk, payment.id, "trying to reverse")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(createDefaultVoteHeads(deps, f.clerk)).rejects.toThrow(ForbiddenError);
    await expect(generateTermInvoices(deps, f.clerk, f.term.id)).rejects.toThrow(ForbiddenError);
  });

  it("money records cannot be changed or deleted, even by the database owner", async () => {
    const f = await feesSchool("Frozen");
    const s = await boarder(f.school.id, f.stream.id);
    const { payment, receipt } = await pay(f.bursar, s.id, "750");
    await expect(
      owner.payment.update({ where: { id: payment.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(owner.receipt.delete({ where: { id: receipt.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.ledgerLine.deleteMany({ where: { studentId: s.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      withContext(appUnguarded, { userId: f.bursar.userId, schoolId: f.school.id }, (tx) =>
        tx.payment.update({ where: { id: payment.id }, data: { amountCents: 1 } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("receipt numbers", () => {
  it("are sequential and gap-free under concurrent payments", async () => {
    const f = await feesSchool("Concurrent");
    const s = await boarder(f.school.id, f.stream.id);
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(f.bursar, s.id, "100")));
    const numbers = results.map((r) => r.receipt.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  }, 60_000);

  it("are not used up by a payment that fails", async () => {
    const f = await feesSchool("Rollback");
    const s = await boarder(f.school.id, f.stream.id);
    const ref = `CHQ-${Date.now()}`;
    await pay(f.bursar, s.id, "100", "bank", ref);
    await expect(pay(f.bursar, s.id, "100", "bank", ref)).rejects.toThrow(/already recorded/);
    const third = await pay(f.bursar, s.id, "100");
    expect(third.receipt.number).toBe(2);
  });
});

describe("discounts, bursaries and opening balances", () => {
  it("apply a sibling discount to the second child and a bursary from its sponsor", async () => {
    const f = await feesSchool("Siblings");
    const older = await boarder(f.school.id, f.stream.id, { dob: "2013-01-01" });
    const younger = await boarder(f.school.id, f.stream.id, { dob: "2014-06-01" });
    const parent = await owner.user.create({ data: { phone: randomPhone(), name: "Parent" } });
    for (const s of [older, younger]) {
      await owner.guardianLink.create({
        data: {
          schoolId: f.school.id,
          studentId: s.id,
          userId: parent.id,
          name: "Mama",
          relationship: "mother",
        },
      });
    }
    await addSiblingDiscount(deps, f.bursar, {
      name: "Second child",
      siblingPosition: "2",
      percent: "10",
      voteHeadId: f.vh("Tuition"),
    });
    const sponsored = await boarder(f.school.id, f.stream.id);
    const adm = (await owner.student.findUniqueOrThrow({ where: { id: sponsored.id } }))
      .admissionNumber;
    await addBursary(deps, f.bursar, {
      admissionNumber: adm,
      kind: "bursary",
      sponsorName: "Kilifi County Bursary",
      coverage: "percent",
      percent: "50",
    });

    const preview = await previewTermInvoices(deps, f.bursar, f.term.id);
    expect(preview.totals).toMatchObject({
      discountCount: 1,
      discountCents: 150_000,
      bursaryCount: 1,
      bursaryCents: 1_725_000,
    });
    await generateTermInvoices(deps, f.bursar, f.term.id);
    expect((await position(f.bursar, older.id)).balanceCents).toBe(3_450_000);
    expect((await position(f.bursar, younger.id)).balanceCents).toBe(3_300_000);
    expect((await position(f.bursar, sponsored.id)).balanceCents).toBe(1_725_000);
    const entry = await owner.ledgerEntry.findFirstOrThrow({
      where: { studentId: sponsored.id, type: "bursary" },
    });
    expect(entry.description).toBe("Bursary: Kilifi County Bursary");
  });

  it("post opening balances once, to Arrears (debts) or as credit", async () => {
    const f = await feesSchool("Opening");
    const owes = await boarder(f.school.id, f.stream.id);
    const credit = await boarder(f.school.id, f.stream.id);
    await owner.openingBalance.createMany({
      data: [
        { schoolId: f.school.id, studentId: owes.id, amountCents: 500_000, source: "import.xlsx" },
        {
          schoolId: f.school.id,
          studentId: credit.id,
          amountCents: -300_000,
          source: "import.xlsx",
        },
      ],
    });
    const r = await postOpeningBalances(deps, f.bursar);
    expect(r).toMatchObject({ count: 2, owedCents: 500_000, creditCents: 300_000 });
    expect((await position(f.bursar, owes.id)).byVoteHead.get(f.vh("Arrears"))).toBe(500_000);
    expect((await position(f.bursar, credit.id)).unallocatedCreditCents).toBe(300_000);
    await expect(postOpeningBalances(deps, f.bursar)).rejects.toThrow(
      /no opening balances waiting/,
    );
    // Credit pays the new term invoice straight away.
    await generateTermInvoices(deps, f.bursar, f.term.id);
    const p = await position(f.bursar, credit.id);
    expect(p.balanceCents).toBe(3_150_000);
    expect(p.unallocatedCreditCents).toBe(0);
  });
});

describe("school walls for money", () => {
  it("School B cannot see School A's payments, receipts or ledger, even with raw SQL", async () => {
    const a = await feesSchool("Money A");
    const b = await feesSchool("Money B");
    const s = await boarder(a.school.id, a.stream.id);
    const { payment } = await pay(a.bursar, s.id, "1234");
    const db = scopedDb(appUnguarded, { userId: b.bursar.userId, schoolId: b.school.id });
    expect(await db.payment.findMany({ where: { id: payment.id } })).toEqual([]);
    expect(await db.receipt.findMany({ where: { paymentId: payment.id } })).toEqual([]);
    expect(await db.ledgerEntry.findMany({ where: { studentId: s.id } })).toEqual([]);
    expect(
      await db.$queryRaw<unknown[]>`SELECT * FROM payments WHERE id = ${payment.id}::uuid`,
    ).toEqual([]);
    expect(
      await db.$queryRaw<unknown[]>`SELECT * FROM ledger_lines WHERE student_id = ${s.id}::uuid`,
    ).toEqual([]);
    await expect(reversePayment(deps, b.bursar, payment.id, "not my school")).rejects.toThrow(
      /not found/,
    );
  });
});
