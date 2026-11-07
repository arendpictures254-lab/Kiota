import { describe, expect, it } from "vitest";
import {
  averageCostCents,
  formatQty,
  isFlagged,
  issueValueCents,
  packsToMilli,
  parseQty,
  positionOf,
  remainingBatches,
  suggestedMilli,
  variancePermille,
} from "./stock";

describe("quantities", () => {
  it("are thousandths of the base unit, shown in friendly units", () => {
    expect(parseQty("1.5")).toBe(1500);
    expect(parseQty("0.15")).toBe(150);
    expect(parseQty("1,250")).toBe(1_250_000);
    expect(parseQty("abc")).toBeNull();
    expect(parseQty("1.2345")).toBeNull();
    expect(formatQty(150, "kg")).toBe("150 g");
    expect(formatQty(1250, "kg")).toBe("1.25 kg");
    expect(formatQty(10, "litre")).toBe("10 ml");
    expect(formatQty(3000, "piece")).toBe("3 pieces");
    expect(formatQty(1000, "piece")).toBe("1 piece");
  });

  it("packs convert to base units (a 90 kg bag, a 20 litre jerrycan)", () => {
    expect(packsToMilli(3, 90_000)).toBe(270_000);
    expect(packsToMilli(2, 20_000)).toBe(40_000);
    expect(() => packsToMilli(0, 90_000)).toThrow();
    expect(() => packsToMilli(1.5, 90_000)).toThrow();
  });
});

describe("on hand", () => {
  it("is the sum of the movements, never typed in", () => {
    expect(
      positionOf([
        { quantityMilli: 90_000, valueCents: 450_000 },
        { quantityMilli: -12_500, valueCents: -62_500 },
        { quantityMilli: -500, valueCents: -2_500 },
      ]),
    ).toEqual({ quantityMilli: 77_000, valueCents: 385_000 });
  });
});

describe("weighted average cost", () => {
  it("values issues at the average of what is on hand", () => {
    // 90 kg at KES 50/kg, then 90 kg at KES 60/kg: average KES 55/kg.
    const onHand = positionOf([
      { quantityMilli: 90_000, valueCents: 450_000 },
      { quantityMilli: 90_000, valueCents: 540_000 },
    ]);
    expect(averageCostCents(onHand)).toBe(5_500);
    expect(issueValueCents(onHand, 10_000)).toBe(55_000); // 10 kg
    expect(issueValueCents(onHand, 150)).toBe(825); // 150 g = KES 8.25
    // Taking everything takes all the value: nothing is left over by rounding.
    expect(issueValueCents({ quantityMilli: 3_000, valueCents: 1_000 }, 3_000)).toBe(1_000);
    expect(issueValueCents({ quantityMilli: 3_000, valueCents: 1_000 }, 1_000)).toBe(333);
  });
});

describe("meal variance", () => {
  it("compares actual issues with the ration scale, against the school's percentage", () => {
    const suggested = suggestedMilli(150, 200); // 150 g x 200 students = 30 kg
    expect(suggested).toBe(30_000);
    expect(variancePermille(suggested, 33_000)).toBe(100); // 10% more
    expect(isFlagged(100, 10)).toBe(false); // exactly 10%: not flagged
    expect(variancePermille(suggested, 33_300)).toBe(110);
    expect(isFlagged(110, 10)).toBe(true);
    expect(isFlagged(variancePermille(suggested, 26_000), 10)).toBe(true); // 13.3% less
    expect(variancePermille(0, 500)).toBeNull();
    expect(isFlagged(null, 10)).toBe(false);
  });
});

describe("expiring soon", () => {
  it("assumes the oldest stock is used first", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const receipts = [
      { id: "a", quantityMilli: 10_000, occurredOn: d("2026-10-01") },
      { id: "b", quantityMilli: 10_000, occurredOn: d("2026-10-15") },
      { id: "c", quantityMilli: 10_000, occurredOn: d("2026-11-01") },
    ];
    // 15 kg on hand: all of the newest delivery and half of the one before.
    expect(remainingBatches(receipts, 15_000).map((r) => [r.id, r.remainingMilli])).toEqual([
      ["c", 10_000],
      ["b", 5_000],
    ]);
    expect(remainingBatches(receipts, 0)).toEqual([]);
  });
});
