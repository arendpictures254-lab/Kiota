/**
 * Leave-out rules, pure: shared by the gate screen (offline, in the browser) and the server.
 *
 * Statuses: awaiting_parent (another collector, waiting for the parent's YES) → pending
 * (waiting for an approver) → approved (pass issued) → out (left through the gate) → returned.
 * Or declined / cancelled. Each pass allows one exit and one return.
 */

export type LeaveoutStatus =
  "awaiting_parent" | "pending" | "approved" | "declined" | "cancelled" | "out" | "returned";

/** How early before the leave time the gate lets a child out. */
export const EARLY_EXIT_MS = 2 * 60 * 60 * 1000;

export type PassState = {
  status: string;
  leaveAt: Date | string;
  returnAt: Date | string;
};

export type NotValidReason =
  "not_found" | "cancelled" | "declined" | "not_approved" | "used" | "expired" | "too_early";

export type Verdict =
  | { valid: true; action: "exit" | "return"; late: boolean }
  | { valid: false; reason: NotValidReason };

/** What the gate may do with this pass now: let the child out, take them back, or refuse. */
export function passVerdict(p: PassState | null, now: Date): Verdict {
  if (!p) return { valid: false, reason: "not_found" };
  const leave = new Date(p.leaveAt).getTime();
  const back = new Date(p.returnAt).getTime();
  switch (p.status) {
    case "cancelled":
      return { valid: false, reason: "cancelled" };
    case "declined":
      return { valid: false, reason: "declined" };
    case "awaiting_parent":
    case "pending":
      return { valid: false, reason: "not_approved" };
    case "returned":
      return { valid: false, reason: "used" };
    case "out":
      return { valid: true, action: "return", late: now.getTime() > back };
    case "approved":
      if (now.getTime() < leave - EARLY_EXIT_MS) return { valid: false, reason: "too_early" };
      if (now.getTime() > back) return { valid: false, reason: "expired" };
      return { valid: true, action: "exit", late: false };
    default:
      return { valid: false, reason: "not_found" };
  }
}

export const REASON_TEXT: Record<NotValidReason, string> = {
  not_found: "Not found: this is not a pass for this school",
  cancelled: "Cancelled",
  declined: "Declined",
  not_approved: "Not approved yet",
  used: "Already used: out and back",
  expired: "Expired: past the return time",
  too_early: "Wrong time: too early to leave",
};

/** A 4-digit pickup code (never starting with 0, so it reads well in an SMS). */
export function pickupCode(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}

const NAIROBI = "Africa/Nairobi";

/** "14:05", Nairobi time. */
export function timeOfDay(d: Date | string) {
  return new Date(d).toLocaleTimeString("en-KE", {
    timeZone: NAIROBI,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "Fri 13 Nov, 14:05", Nairobi time. */
export function whenText(d: Date | string, locale: "en" | "sw" = "en") {
  const x = new Date(d);
  const date = x.toLocaleDateString(locale === "sw" ? "sw-KE" : "en-KE", {
    timeZone: NAIROBI,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${date}, ${timeOfDay(x)}`;
}

/** A date and time typed in Nairobi time ("2026-11-13T14:00") as an instant. */
export function nairobiInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The value for an <input type="datetime-local"> in Nairobi time. */
export function toNairobiInput(d: Date) {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);
}
