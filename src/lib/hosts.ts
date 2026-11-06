/**
 * The two public addresses. kiota.app is the marketing site; app.kiota.app is sign-in and the
 * app. In development: http://localhost:3000 and http://app.localhost:3000.
 * Set SITE_URL and APP_URL in production (see .env.production.example).
 */
export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const APP_URL = (process.env.APP_URL ?? "http://app.localhost:3000").replace(/\/$/, "");

export const SITE_HOST = new URL(SITE_URL).host.toLowerCase();
export const APP_HOST = new URL(APP_URL).host.toLowerCase();

/** Public site pages (paths on the site address). */
export const SITE_PAGES = [
  "/",
  "/features",
  "/parents",
  "/security",
  "/demo",
  "/privacy",
  "/terms",
];

/** App paths that must never be served on the site address. */
export const APP_PREFIXES = [
  "/sign-in",
  "/dashboard",
  "/schools",
  "/admin",
  "/files",
  "/r",
  "/parent",
  "/choose",
  "/account",
  "/offline",
  "/gate",
];

export const WHATSAPP_URL = "https://wa.me/254720942426";
export const WHATSAPP_DISPLAY = "+254 720 942 426";

export function hasPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}
