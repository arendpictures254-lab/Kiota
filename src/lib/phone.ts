/**
 * Phone numbers are stored in E.164 format, e.g. +254712345678.
 * People type them many ways (0712 345 678, 254712345678, +254 712...), so normalise first.
 */
const KENYA_MOBILE = /^\+254[17]\d{8}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-().]/g, "");
  if (!cleaned) return null;

  let candidate: string;
  if (cleaned.startsWith("+")) candidate = cleaned;
  else if (cleaned.startsWith("00")) candidate = `+${cleaned.slice(2)}`;
  else if (/^254\d{9}$/.test(cleaned)) candidate = `+${cleaned}`;
  else if (/^0[17]\d{8}$/.test(cleaned)) candidate = `+254${cleaned.slice(1)}`;
  else if (/^[17]\d{8}$/.test(cleaned)) candidate = `+254${cleaned}`;
  else return null;

  if (candidate.startsWith("+254")) return KENYA_MOBILE.test(candidate) ? candidate : null;
  return E164.test(candidate) ? candidate : null;
}

/** +254712345678 -> 0712 345 678 for display. */
export function formatPhone(e164: string): string {
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
