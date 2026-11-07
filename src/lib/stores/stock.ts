/**
 * Stock maths, pure (no database): quantities, units and packs, weighted average cost, meal
 * variances and which deliveries are still on the shelf (expiry).
 *
 * Quantities are integers in thousandths of the item's base unit ("milli"): 150 g of an item
 * counted in kg is 150; 2 pieces are 2000. Values are integer cents. Stock on hand and its value
 * are always the sums of the movements.
 */

export const UNITS = [
  { key: "kg", label: "kg", small: "g" },
  { key: "litre", label: "litre", small: "ml" },
  { key: "piece", label: "piece", small: null },
  { key: "packet", label: "packet", small: null },
  { key: "bar", label: "bar", small: null },
  { key: "tin", label: "tin", small: null },
  { key: "ream", label: "ream", small: null },
  { key: "dozen", label: "dozen", small: null },
] as const;
export type UnitKey = (typeof UNITS)[number]["key"];

const plural = (unit: string, n: number) =>
  n === 1 || unit === "kg" ? unit : unit.endsWith("s") ? unit : `${unit}s`;

/** "150 g", "1.25 kg", "3 pieces", "0.5 litre". */
export function formatQty(milli: number, unit: string): string {
  const u = UNITS.find((x) => x.key === unit);
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  if (u?.small && abs > 0 && abs < 1000) return `${sign}${abs} ${u.small}`;
  const n = abs / 1000;
  const text = Number.isInteger(n)
    ? n.toLocaleString("en-KE")
    : n.toLocaleString("en-KE", { maximumFractionDigits: 3 });
  return `${sign}${text} ${plural(unit, n)}`;
}

/** A typed amount in base units ("1.5", "1,250", "0.15") as milli, or null. */
export function parseQty(input: unknown): number | null {
  const s = String(input ?? "")
    .trim()
    .replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) return null;
  const milli = Math.round(Number(s) * 1000);
  return Number.isSafeInteger(milli) ? milli : null;
}

/** Packs received (a 90 kg bag) as base-unit milli. */
export function packsToMilli(packs: number, packSizeMilli: number): number {
  if (!Number.isInteger(packs) || packs <= 0)
    throw new Error("packs must be a positive whole number");
  if (!Number.isInteger(packSizeMilli) || packSizeMilli <= 0) throw new Error("bad pack size");
  return packs * packSizeMilli;
}

export type Position = { quantityMilli: number; valueCents: number };

export function positionOf(movements: readonly Position[]): Position {
  return movements.reduce(
    (p, m) => ({
      quantityMilli: p.quantityMilli + m.quantityMilli,
      valueCents: p.valueCents + m.valueCents,
    }),
    { quantityMilli: 0, valueCents: 0 },
  );
}

/**
 * The value of taking `quantityMilli` out of stock, at weighted average cost: the current value
 * times the share of the quantity taken. Taking everything takes all the value (no leftover
 * cents). Integer maths throughout (BigInt for the multiplication).
 */
export function issueValueCents(onHand: Position, quantityMilli: number): number {
  if (quantityMilli <= 0) throw new Error("issue a positive quantity");
  if (onHand.quantityMilli <= 0) return 0;
  if (quantityMilli >= onHand.quantityMilli) return onHand.valueCents;
  const v =
    (BigInt(onHand.valueCents) * BigInt(quantityMilli) * BigInt(2) + BigInt(onHand.quantityMilli)) /
    (BigInt(onHand.quantityMilli) * BigInt(2));
  return Number(v);
}

/** The weighted average cost of one base unit, in cents (for display). */
export function averageCostCents(p: Position): number | null {
  return p.quantityMilli > 0 ? Math.round((p.valueCents * 1000) / p.quantityMilli) : null;
}

/**
 * How far an actual issue is from the ration scale, in tenths of a percent (125 = 12.5% more).
 * Null when the ration scale suggests nothing for the item.
 */
export function variancePermille(suggestedMilli: number, actualMilli: number): number | null {
  if (suggestedMilli <= 0) return null;
  return Math.round(((actualMilli - suggestedMilli) * 1000) / suggestedMilli);
}

/** Flagged when any line differs from the ration scale by more than the school's percentage. */
export function isFlagged(permille: number | null, thresholdPercent: number): boolean {
  return permille !== null && Math.abs(permille) > thresholdPercent * 10;
}

/** The ration scale's suggestion for a meal: per student × students served. */
export const suggestedMilli = (perStudentMilli: number, served: number) => perStudentMilli * served;

/**
 * Which deliveries are still on the shelf, assuming the oldest is used first: walk the
 * receipts from the newest back until they cover what is on hand. Used for "expiring soon".
 */
export function remainingBatches<T extends { quantityMilli: number; occurredOn: Date }>(
  receipts: readonly T[],
  onHandMilli: number,
): (T & { remainingMilli: number })[] {
  let left = Math.max(0, onHandMilli);
  const out: (T & { remainingMilli: number })[] = [];
  for (const r of [...receipts].sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime())) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantityMilli);
    out.push({ ...r, remainingMilli: take });
    left -= take;
  }
  return out;
}

/** "KES 1,234.50" from cents (stock values are not always whole shillings). */
export function kesExact(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const shillings = Math.floor(abs / 100).toLocaleString("en-KE");
  const rest = abs % 100;
  return `${sign}KES ${shillings}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** "KES 57,207" (headline figures: whole shillings, rounded). */
export const kesWhole = (cents: number) =>
  `${cents < 0 ? "-" : ""}KES ${Math.round(Math.abs(cents) / 100).toLocaleString("en-KE")}`;
