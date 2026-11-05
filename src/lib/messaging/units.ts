/**
 * SMS unit counting, the way the networks bill it. Pure: used by the composer (live count while
 * typing) and by the server (what a message costs).
 *
 *  - GSM-7 (plain English and Kiswahili): 160 characters in one SMS; split messages carry 153
 *    each. ^ { } [ ] ~ \ | € take two characters' room, and are never split across parts.
 *  - Anything else (emoji, curly quotes, accented letters outside GSM-7) switches the whole
 *    message to Unicode: 70 characters in one SMS, 67 per part; an emoji counts as two.
 */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

const basic = new Set(GSM_BASIC);
const extended = new Set(GSM_EXTENDED);

export type SmsEncoding = "GSM-7" | "Unicode";

export type SmsCount = {
  encoding: SmsEncoding;
  /** Characters as the network counts them (GSM-7 septets, or UTF-16 code units). */
  length: number;
  /** SMS units billed. 0 for an empty message. */
  units: number;
  /** Room in one SMS for this encoding (160 or 70). */
  singleLimit: number;
  /** Room per part once split (153 or 67). */
  partLimit: number;
  /** Characters left before the next unit starts. */
  remaining: number;
  /** Characters that forced Unicode, for a hint ("’ is not a plain character"). */
  unicodeChars: string[];
};

export function isGsm7(text: string): boolean {
  for (const ch of text) if (!basic.has(ch) && !extended.has(ch)) return false;
  return true;
}

/** Split sizes per character: GSM-7 septets (1 or 2), or UTF-16 code units (1 or 2). */
function weights(text: string, encoding: SmsEncoding): number[] {
  const out: number[] = [];
  for (const ch of text) {
    out.push(encoding === "GSM-7" ? (extended.has(ch) ? 2 : 1) : ch.length);
  }
  return out;
}

/** Number of parts when no character may be split across two parts. */
function partsNeeded(ws: number[], partLimit: number): { parts: number; lastFill: number } {
  let parts = 1;
  let fill = 0;
  for (const w of ws) {
    if (fill + w > partLimit) {
      parts++;
      fill = 0;
    }
    fill += w;
  }
  return { parts, lastFill: fill };
}

export function countSms(text: string): SmsCount {
  const encoding: SmsEncoding = isGsm7(text) ? "GSM-7" : "Unicode";
  const singleLimit = encoding === "GSM-7" ? 160 : 70;
  const partLimit = encoding === "GSM-7" ? 153 : 67;
  const ws = weights(text, encoding);
  const length = ws.reduce((n, w) => n + w, 0);
  const unicodeChars =
    encoding === "Unicode"
      ? [...new Set([...text].filter((c) => !basic.has(c) && !extended.has(c)))]
      : [];
  if (length === 0) {
    return {
      encoding,
      length,
      units: 0,
      singleLimit,
      partLimit,
      remaining: singleLimit,
      unicodeChars,
    };
  }
  if (length <= singleLimit) {
    return {
      encoding,
      length,
      units: 1,
      singleLimit,
      partLimit,
      remaining: singleLimit - length,
      unicodeChars,
    };
  }
  const { parts, lastFill } = partsNeeded(ws, partLimit);
  return {
    encoding,
    length,
    units: parts,
    singleLimit,
    partLimit,
    remaining: partLimit - lastFill,
    unicodeChars,
  };
}

/**
 * Look-alikes (pasted from Word, WhatsApp or a phone keyboard) that would silently switch a
 * whole message to Unicode (70 characters per SMS instead of 160), with plain GSM-7 ones.
 * Kiswahili needs nothing here: it is written in plain Latin letters.
 */
const PLAIN: Record<string, string> = {
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "‛": "'",
  "′": "'", // ′
  "´": "'", // ´
  "`": "'",
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "‟": '"',
  "″": '"', // ″
  "«": '"', // «
  "»": '"', // »
  "‐": "-", // hyphen
  "‑": "-",
  "‒": "-",
  "–": "-", // –
  "—": "-", // —
  "―": "-",
  "−": "-", // minus
  "•": "-", // •
  "…": "...", // …
  " ": " ", // non-breaking space
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "", // zero-width characters
  "‌": "",
  "‍": "",
  "﻿": "",
};

/** Replace curly quotes, long dashes and similar with plain GSM-7 characters. */
export function toPlainSms(text: string): string {
  return [...text].map((c) => PLAIN[c] ?? c).join("");
}

/** The look-alikes in a text that toPlainSms() would replace (for the composer's note). */
export function replacedChars(text: string): string[] {
  return [...new Set([...text].filter((c) => c in PLAIN))];
}
