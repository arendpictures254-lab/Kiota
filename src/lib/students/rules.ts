/**
 * Pure rules shared by the student forms and the Excel import, so both accept exactly the same
 * values. No database access here.
 */
import { clean } from "@/lib/service-kit";

export type GenderValue = "male" | "female";
export type RelationshipValue = "mother" | "father" | "guardian" | "sponsor" | "other";
export type LanguageValue = "en" | "sw";
export type StatusValue = "active" | "transferred" | "graduated" | "suspended" | "withdrawn";

export const GENDERS: { value: GenderValue; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
export const RELATIONSHIPS: { value: RelationshipValue; label: string }[] = [
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "guardian", label: "Guardian" },
  { value: "sponsor", label: "Sponsor" },
  { value: "other", label: "Other" },
];
export const LANGUAGES: { value: LanguageValue; label: string }[] = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
];
export const STATUSES: { value: StatusValue; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "transferred", label: "Transferred" },
  { value: "graduated", label: "Graduated" },
  { value: "suspended", label: "Suspended" },
  { value: "withdrawn", label: "Withdrawn" },
];

const key = (v: unknown) => (clean(v) ?? "").toLowerCase();

export function parseGender(v: unknown): GenderValue | null {
  const k = key(v);
  if (["female", "f", "girl"].includes(k)) return "female";
  if (["male", "m", "boy"].includes(k)) return "male";
  return null;
}

/** true = boarder, false = day scholar, null = not understood. */
export function parseBoarding(v: unknown): boolean | null {
  const k = key(v);
  if (["boarder", "boarding", "b"].includes(k)) return true;
  if (["day", "day scholar", "d", "day-scholar"].includes(k)) return false;
  return null;
}

export function parseRelationship(v: unknown): RelationshipValue | null {
  const k = key(v);
  const found = RELATIONSHIPS.find((r) => r.value === k);
  if (found) return found.value;
  if (["mum", "mom", "mama"].includes(k)) return "mother";
  if (["dad", "baba"].includes(k)) return "father";
  return null;
}

/** Blank means English. */
export function parseLanguage(v: unknown): LanguageValue | null {
  const k = key(v);
  if (k === "" || k === "english" || k === "en") return "en";
  if (k === "kiswahili" || k === "swahili" || k === "sw") return "sw";
  return null;
}

/** Yes/No. Blank returns the default. null = not understood. */
export function parseYesNo(v: unknown, fallback: boolean): boolean | null {
  const k = key(v);
  if (k === "") return fallback;
  if (["yes", "y", "true", "1", "ndiyo"].includes(k)) return true;
  if (["no", "n", "false", "0", "hapana"].includes(k)) return false;
  return null;
}

/** Default message settings by relationship: sponsors get fees only. */
export function guardianDefaults(relationship: RelationshipValue) {
  const sponsor = relationship === "sponsor";
  return {
    receivesFees: true,
    receivesAcademics: !sponsor,
    receivesBoarding: !sponsor,
    authorisedToCollect: relationship === "mother" || relationship === "father",
    whatsapp: false,
  };
}

/** A plain-English problem with a date of birth, or null when it is plausible (age 2 to 25). */
export function dateOfBirthProblem(dob: Date, today = new Date()): string | null {
  if (dob > today) return "The date of birth is in the future.";
  const age = (today.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 2) return "The child would be younger than 2.";
  if (age > 25) return "The child would be older than 25.";
  return null;
}

/**
 * Parse a shilling amount into integer cents. Accepts "12500", "12,500.50", "KES 1,200",
 * "(500)" or "-500" for a credit. Returns { cents } or { error }.
 */
export function parseKesToCents(v: unknown): { cents: number | null } | { error: string } {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { error: "This is not a number." };
    return { cents: Math.round(v * 100) };
  }
  let s = clean(v);
  if (!s) return { cents: null };
  s = s
    .replace(/^kes\s*/i, "")
    .replace(/^ksh\.?\s*/i, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: "This is not an amount in shillings." };
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2_000_000_000) {
    return { error: "This amount is too large." };
  }
  return { cents: negative ? -cents : cents };
}

export function fullName(s: { firstName: string; middleName?: string | null; lastName: string }) {
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
}

/** Compare names loosely (case, spaces). */
export function sameName(
  a: { firstName: string; lastName: string },
  b: { firstName: string; lastName: string },
) {
  const n = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
  return n(a.firstName) === n(b.firstName) && n(a.lastName) === n(b.lastName);
}
