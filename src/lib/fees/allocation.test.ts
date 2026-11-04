import { describe, expect, it } from "vitest";
import {
  type Line,
  allocatePayment,
  applyCredit,
  creditAgainst,
  dueByDate,
  firstMissedDueDate,
  kes,
  percentOf,
  positionFromLines,
  rebalanceUnallocatedDebt,
  receiptNo,
  sumLines,
} from "./allocation";

const heads = [
  { id: "arrears", priority: 1, name: "Arrears" },
  { id: "tuition", priority: 2, name: "Tuition" },
  { id: "boarding", priority: 3, name: "Boarding" },
  { id: "exam", priority: 4, name: "Exam" },
];
const invoice: Line[] = [
  { voteHeadId: "tuition", amountCents: 1_500_000 },
  { voteHeadId: "boarding", amountCents: 1_800_000 },
  { voteHeadId: "exam", amountCents: 150_000 },
];

describe("allocatePayment", () => {
  it("pays vote heads in the school's priority order", () => {
    const pos = positionFromLines([...invoice, { voteHeadId: "arrears", amountCents: 200_000 }]);
    expect(allocatePayment(2_000_000, pos, heads)).toEqual([
      { voteHeadId: "arrears", amountCents: -200_000 },
      { voteHeadId: "tuition", amountCents: -1_500_000 },
      { voteHeadId: "boarding", amountCents: -300_000 },
    ]);
  });

  it("follows priority, not the order of the invoice", () => {
    const reordered = heads.map((h) => (h.id === "exam" ? { ...h, priority: 0 } : h));
    const lines = allocatePayment(100_000, positionFromLines(invoice), reordered);
    expect(lines).toEqual([{ voteHeadId: "exam", amountCents: -100_000 }]);
  });

  it("turns an overpayment into unallocated credit", () => {
    const pos = positionFromLines(invoice); // owes 3,450,000
    const lines = allocatePayment(4_000_000, pos, heads);
    expect(lines.at(-1)).toEqual({ voteHeadId: null, amountCents: -550_000 });
    expect(sumLines(lines)).toBe(-4_000_000);
    const after = positionFromLines([...invoice, ...lines]);
    expect(after.balanceCents).toBe(-550_000);
    expect(after.unallocatedCreditCents).toBe(550_000);
    expect([...after.byVoteHead.values()].every((v) => v === 0)).toBe(true);
  });

  it("refuses zero, negative and fractional amounts", () => {
    const pos = positionFromLines(invoice);
    expect(() => allocatePayment(0, pos, heads)).toThrow();
    expect(() => allocatePayment(-5, pos, heads)).toThrow();
    expect(() => allocatePayment(10.5, pos, heads)).toThrow();
  });
});

describe("credit carried forward", () => {
  it("pays the next invoice from earlier credit, by priority, as a zero-sum entry", () => {
    const earlier: Line[] = [{ voteHeadId: null, amountCents: -2_000_000 }]; // KES 20,000 credit
    const pos = positionFromLines([...earlier, ...invoice]);
    const lines = applyCredit(pos, heads);
    expect(sumLines(lines)).toBe(0);
    expect(lines).toEqual([
      { voteHeadId: "tuition", amountCents: -1_500_000 },
      { voteHeadId: "boarding", amountCents: -500_000 },
      { voteHeadId: null, amountCents: 2_000_000 },
    ]);
    const after = positionFromLines([...earlier, ...invoice, ...lines]);
    expect(after.unallocatedCreditCents).toBe(0);
    expect(after.byVoteHead.get("boarding")).toBe(1_300_000);
    expect(after.balanceCents).toBe(1_450_000);
  });

  it("does nothing without credit", () => {
    expect(applyCredit(positionFromLines(invoice), heads)).toEqual([]);
  });
});

describe("reversals", () => {
  it("restore exactly what the payment had paid", () => {
    const pay = allocatePayment(2_000_000, positionFromLines(invoice), heads);
    const reversal = pay.map((l) => ({ ...l, amountCents: -l.amountCents }));
    const after = positionFromLines([...invoice, ...pay, ...reversal]);
    expect(after.balanceCents).toBe(3_450_000);
    expect(after.byVoteHead.get("tuition")).toBe(1_500_000);
    expect(after.byVoteHead.get("boarding")).toBe(1_800_000);
  });

  it("move debt left on the unallocated line back onto vote heads", () => {
    // Overpaid, credit later used on an invoice, then the overpayment was reversed.
    const pay: Line[] = [{ voteHeadId: null, amountCents: -1_000_000 }];
    const inv: Line[] = [{ voteHeadId: "tuition", amountCents: 800_000 }];
    const used = applyCredit(positionFromLines([...pay, ...inv]), heads);
    const reversal = pay.map((l) => ({ ...l, amountCents: -l.amountCents }));
    const pos = positionFromLines([...pay, ...inv, ...used, ...reversal]);
    expect(pos.balanceCents).toBe(800_000);
    expect(pos.unallocatedCreditCents).toBe(-800_000);
    const fix = rebalanceUnallocatedDebt(pos, new Map([["tuition", 800_000]]), heads);
    expect(sumLines(fix)).toBe(0);
    const after = positionFromLines([...pay, ...inv, ...used, ...reversal, ...fix]);
    expect(after.byVoteHead.get("tuition")).toBe(800_000);
    expect(after.unallocatedCreditCents).toBe(0);
    expect(after.balanceCents).toBe(800_000);
  });
});

describe("discounts and bursaries", () => {
  it("never credit more than the invoice line", () => {
    expect(
      creditAgainst(9_999_999, [{ voteHeadId: "tuition", amountCents: 1_500_000 }], heads),
    ).toEqual([{ voteHeadId: "tuition", amountCents: -1_500_000 }]);
  });

  it("spread a fixed amount over vote heads by priority", () => {
    expect(creditAgainst(2_000_000, invoice, heads)).toEqual([
      { voteHeadId: "tuition", amountCents: -1_500_000 },
      { voteHeadId: "boarding", amountCents: -500_000 },
    ]);
  });

  it("percentages round to whole cents", () => {
    expect(percentOf(1_500_000, 1000)).toBe(150_000);
    expect(percentOf(333, 5000)).toBe(167);
  });
});

describe("instalments", () => {
  const plan = [
    { dueDate: new Date("2027-01-15"), percentBp: 5000 },
    { dueDate: new Date("2027-02-15"), percentBp: 3000 },
    { dueDate: new Date("2027-03-15"), percentBp: 2000 },
  ];

  it("work out what is due by a date", () => {
    expect(dueByDate(1_000_000, plan, new Date("2027-01-10"))).toBe(0);
    expect(dueByDate(1_000_000, plan, new Date("2027-01-20"))).toBe(500_000);
    expect(dueByDate(1_000_000, plan, new Date("2027-02-20"))).toBe(800_000);
    expect(dueByDate(1_000_000, [], new Date("2027-01-01"))).toBe(1_000_000);
  });

  it("find the first missed due date", () => {
    const today = new Date("2027-02-20");
    expect(firstMissedDueDate(1_000_000, 400_000, plan, today)).toEqual(new Date("2027-01-15"));
    expect(firstMissedDueDate(1_000_000, 600_000, plan, today)).toEqual(new Date("2027-02-15"));
    expect(firstMissedDueDate(1_000_000, 800_000, plan, today)).toBeNull();
  });
});

describe("formatting", () => {
  it("prints shillings and receipt numbers the way schools expect", () => {
    expect(kes(1_250_000)).toBe("KES 12,500");
    expect(kes(1_250_050)).toBe("KES 12,500.50");
    expect(kes(-50_000)).toBe("-KES 500");
    expect(receiptNo(4182)).toBe("004182");
  });
});
