import { describe, expect, it } from "vitest";
import { homeFor, splitBalance } from "./service";

const base = { staffSchools: 0, isPlatformAdmin: false, hasChildren: false, mode: null } as const;

describe("where people land after signing in", () => {
  it("sends a parent to the portal and staff to their school", () => {
    expect(homeFor({ ...base, hasChildren: true })).toBe("/parent");
    expect(homeFor({ ...base, staffSchools: 1 })).toBe("/dashboard");
    expect(homeFor({ ...base, staffSchools: 2 })).toBe("/schools");
    expect(homeFor({ ...base, isPlatformAdmin: true })).toBe("/admin");
  });

  it("asks someone who is both staff and a parent, then remembers the choice", () => {
    const both = { ...base, staffSchools: 1, hasChildren: true };
    expect(homeFor(both)).toBe("/choose");
    expect(homeFor({ ...both, mode: "parent" })).toBe("/parent");
    expect(homeFor({ ...both, mode: "staff" })).toBe("/dashboard");
    expect(homeFor({ ...both, staffSchools: 2, mode: "staff" })).toBe("/schools");
  });

  it("ignores a parent mode for someone who has no children", () => {
    expect(homeFor({ ...base, staffSchools: 1, mode: "parent" })).toBe("/dashboard");
  });
});

describe("what a parent is asked to pay", () => {
  // Term 1: 50% by 15 Jan, 30% by 15 Feb, 20% by 15 Mar, on a KES 40,000 invoice.
  const invoice = {
    totalCents: 4_000_000,
    installments: [
      { dueDate: new Date("2027-01-15T00:00:00+03:00"), percentBp: 5000 },
      { dueDate: new Date("2027-02-15T00:00:00+03:00"), percentBp: 3000 },
      { dueDate: new Date("2027-03-15T00:00:00+03:00"), percentBp: 2000 },
    ],
  };

  it("a one-off charge since the invoice (a uniform) is due now, and is not called arrears", () => {
    const r = splitBalance(
      4_000_000 + 130_000,
      invoice,
      new Date("2027-01-02T09:00:00+03:00"),
      130_000,
    );
    expect(r).toMatchObject({
      dueNowCents: 130_000,
      chargesCents: 130_000,
      arrearsCents: 0,
      restOfYearCents: 4_000_000,
    });
    // Paid down to less than the charge: only what is left of it is due.
    expect(
      splitBalance(50_000, invoice, new Date("2027-01-02T09:00:00+03:00"), 130_000),
    ).toMatchObject({
      dueNowCents: 50_000,
      chargesCents: 50_000,
      restOfYearCents: 0,
    });
  });

  it("before the first date: nothing due now, the rest of the year with the next date", () => {
    expect(splitBalance(4_000_000, invoice, new Date("2027-01-02T09:00:00+03:00"))).toEqual({
      dueNowCents: 0,
      restOfYearCents: 4_000_000,
      arrearsCents: 0,
      chargesCents: 0,
      nextDue: { date: invoice.installments[0].dueDate, amountCents: 2_000_000 },
    });
  });

  it("counts an instalment due today as due now", () => {
    const today = new Date("2027-01-15T10:00:00+03:00");
    expect(splitBalance(4_000_000, invoice, today)).toMatchObject({
      dueNowCents: 2_000_000,
      restOfYearCents: 2_000_000,
      arrearsCents: 0,
      chargesCents: 0,
      nextDue: { amountCents: 1_200_000 },
    });
  });

  it("calls only balances from previous terms arrears", () => {
    // KES 5,000 left from last term on top of this term's invoice.
    const s = splitBalance(4_500_000, invoice, new Date("2027-01-02T09:00:00+03:00"));
    expect(s).toMatchObject({
      dueNowCents: 500_000,
      arrearsCents: 500_000,
      restOfYearCents: 4_000_000,
    });
  });

  it("a part payment comes off what is due now first", () => {
    const s = splitBalance(3_000_000, invoice, new Date("2027-01-20T09:00:00+03:00"));
    expect(s).toMatchObject({
      dueNowCents: 1_000_000,
      arrearsCents: 0,
      restOfYearCents: 2_000_000,
    });
  });

  it("nothing is due from a child in credit", () => {
    expect(splitBalance(-50_000, invoice, new Date("2027-02-20T09:00:00+03:00"))).toMatchObject({
      dueNowCents: 0,
      restOfYearCents: 0,
      arrearsCents: 0,
      chargesCents: 0,
      nextDue: null,
    });
  });
});
