/**
 * Translations for parent-facing screens. Strings live in one file per language (en.ts, sw.ts);
 * code only ever uses keys. Pure: safe in server and client components.
 */
import { kes } from "@/lib/fees/allocation";
import { en, type MessageKey } from "./en";
import { sw } from "./sw";

export type Locale = "en" | "sw";
export type { MessageKey };
export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const LOCALES: readonly Locale[] = ["en", "sw"];
export const LOCALE_COOKIE = "kiota_lang";

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "sw";
}

export function translator(locale: Locale): T {
  const dict: Record<MessageKey, string> = locale === "sw" ? sw : en;
  return (key, vars) => {
    const s = dict[key] ?? en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

/** A few keys resolved up front for a client component. */
export function pick<K extends MessageKey>(t: T, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((k) => [k, t(k)])) as Record<K, string>;
}

export const money = (cents: number) => kes(cents);

export function day(d: Date | string, locale: Locale) {
  return new Date(d).toLocaleDateString(locale === "sw" ? "sw-KE" : "en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
