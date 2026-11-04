/**
 * The ledger's arithmetic, with no database access (unit tested).
 *
 * Sign convention, everywhere in fees: POSITIVE cents = the student owes more (invoice, charge,
 * arrears); NEGATIVE cents = paid or credited (payment, discount, bursary). A ledger line with
 * voteHeadId = null is unallocated credit (an overpayment carried forward).
 */

export type Line = { voteHeadId: string | null; amountCents: number };
export type VoteHeadRef = { id: string; priority: number; name: string };

/** Outstanding per vote head (positive = owed) and unallocated credit (positive = credit). */
export type Position = {
  balanceCents: number;
  byVoteHead: Map<string, number>;
  unallocatedCreditCents: number;
};

export function positionFromLines(lines: readonly Line[]): Position {
  const byVoteHead = new Map<string, number>();
  let unallocated = 0;
  let balance = 0;
  for (const l of lines) {
    balance += l.amountCents;
    if (l.voteHeadId === null) unallocated += l.amountCents;
    else byVoteHead.set(l.voteHeadId, (byVoteHead.get(l.voteHeadId) ?? 0) + l.amountCents);
  }
  return { balanceCents: balance, byVoteHead, unallocatedCreditCents: 0 - unallocated || 0 };
}

export function sumLines(lines: readonly Line[]) {
  return lines.reduce((n, l) => n + l.amountCents, 0);
}

function byPriority(heads: readonly VoteHeadRef[]) {
  return [...heads].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * Split a payment over the vote heads the student still owes, highest priority first.
 * Whatever is left becomes unallocated credit. Returns negative lines summing to -amount.
 */
export function allocatePayment(
  amountCents: number,
  position: Position,
  heads: readonly VoteHeadRef[],
): Line[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Payment must be a positive number of cents");
  }
  const lines: Line[] = [];
  let remaining = amountCents;
  for (const h of byPriority(heads)) {
    if (remaining === 0) break;
    const owed = position.byVoteHead.get(h.id) ?? 0;
    if (owed <= 0) continue;
    const take = Math.min(owed, remaining);
    lines.push({ voteHeadId: h.id, amountCents: -take });
    remaining -= take;
  }
  if (remaining > 0) lines.push({ voteHeadId: null, amountCents: -remaining });
  return lines;
}

/**
 * Use unallocated credit to pay vote heads that are now owed (after an invoice or charge).
 * Returns the lines of a zero-sum "credit_applied" entry, or [] if nothing to do.
 */
export function applyCredit(position: Position, heads: readonly VoteHeadRef[]): Line[] {
  const credit = position.unallocatedCreditCents;
  if (credit <= 0) return [];
  const lines: Line[] = [];
  let remaining = credit;
  for (const h of byPriority(heads)) {
    if (remaining === 0) break;
    const owed = position.byVoteHead.get(h.id) ?? 0;
    if (owed <= 0) continue;
    const take = Math.min(owed, remaining);
    lines.push({ voteHeadId: h.id, amountCents: -take });
    remaining -= take;
  }
  const used = credit - remaining;
  if (used === 0) return [];
  lines.push({ voteHeadId: null, amountCents: used });
  return lines;
}

/**
 * After a reversal the unallocated line can end up owed (positive), e.g. when reversed credit had
 * already paid an invoice. Move that debt back onto vote heads, lowest priority first, limited to
 * what each vote head had been paid. Returns zero-sum lines, or [].
 */
export function rebalanceUnallocatedDebt(
  position: Position,
  paidByVoteHead: Map<string, number>,
  heads: readonly VoteHeadRef[],
): Line[] {
  const debt = -position.unallocatedCreditCents;
  if (debt <= 0) return [];
  const lines: Line[] = [];
  let remaining = debt;
  for (const h of byPriority(heads).reverse()) {
    if (remaining === 0) break;
    const paid = paidByVoteHead.get(h.id) ?? 0;
    if (paid <= 0) continue;
    const give = Math.min(paid, remaining);
    lines.push({ voteHeadId: h.id, amountCents: give });
    remaining -= give;
  }
  const moved = debt - remaining;
  if (moved === 0) return [];
  lines.push({ voteHeadId: null, amountCents: -moved });
  return lines;
}

/** Percent (basis points) of an amount, rounded to whole cents. */
export function percentOf(amountCents: number, bp: number) {
  return Math.round((amountCents * bp) / 10_000);
}

/**
 * A credit (discount or bursary) of `amountCents` against invoice lines, spread in vote head
 * priority order and never more than each line. Returns negative lines.
 */
export function creditAgainst(
  amountCents: number,
  invoiceLines: readonly Line[],
  heads: readonly VoteHeadRef[],
): Line[] {
  const owed = new Map<string, number>();
  for (const l of invoiceLines) {
    if (l.voteHeadId) owed.set(l.voteHeadId, (owed.get(l.voteHeadId) ?? 0) + l.amountCents);
  }
  const lines: Line[] = [];
  let remaining = Math.max(0, amountCents);
  for (const h of byPriority(heads)) {
    if (remaining === 0) break;
    const o = owed.get(h.id) ?? 0;
    if (o <= 0) continue;
    const take = Math.min(o, remaining);
    lines.push({ voteHeadId: h.id, amountCents: -take });
    remaining -= take;
  }
  return lines;
}

export type Installment = { dueDate: Date; percentBp: number };

/**
 * How much of a term invoice is due by `today` under an instalment plan (cumulative), and the
 * earliest due date not yet met for a given amount paid toward the invoice.
 */
export function dueByDate(invoiceCents: number, plan: readonly Installment[], today: Date) {
  const sorted = [...plan].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  let bp = 0;
  for (const i of sorted) if (i.dueDate <= today) bp += i.percentBp;
  if (sorted.length === 0) return invoiceCents;
  return percentOf(invoiceCents, Math.min(bp, 10_000));
}

export function firstMissedDueDate(
  invoiceCents: number,
  paidTowardInvoiceCents: number,
  plan: readonly Installment[],
  today: Date,
): Date | null {
  const sorted = [...plan].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  let bp = 0;
  for (const i of sorted) {
    if (i.dueDate > today) break;
    bp += i.percentBp;
    if (paidTowardInvoiceCents < percentOf(invoiceCents, Math.min(bp, 10_000))) return i.dueDate;
  }
  return null;
}

/** Format integer cents as "KES 12,500" or "KES 12,500.50". */
export function kes(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-KE");
  const frac = abs % 100;
  return `${sign}KES ${whole}${frac ? `.${String(frac).padStart(2, "0")}` : ""}`;
}

/** Receipt number as printed: No. 004182. */
export function receiptNo(n: number) {
  return String(n).padStart(6, "0");
}
