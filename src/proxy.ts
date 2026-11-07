/**
 * Host-based routing: one Next.js app serves two addresses.
 *  - Site (kiota.app):     /, /features, ... are served from src/app/site/*; /v/<code> checks a
 *                          report card (unknown codes are a real 404).
 *                          App paths (/sign-in, /dashboard, ...) redirect to the app address.
 *  - App (app.kiota.app):  sign-in and the app. / goes to the dashboard; site pages redirect
 *                          to the site address; the internal /site/* paths do not exist here.
 * This is routing only. Every permission check still happens on the server in each page/action.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  APP_HOST,
  APP_PREFIXES,
  APP_URL,
  SITE_HOST,
  SITE_PAGES,
  SITE_URL,
  hasPrefix,
} from "@/lib/hosts";

/**
 * An internal rewrite to another path on THIS server. Always clone req.nextUrl: a URL built from
 * req.url carries the visitor's Host (kiota.app), which Next.js would treat as an external
 * rewrite and fetch over the network.
 */
function internal(
  req: NextRequest,
  pathname: string,
  init?: Parameters<typeof NextResponse.rewrite>[1],
) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url, init);
}

const notFound = (req: NextRequest) => internal(req, "/_not-found-kiota");

/**
 * Redirect to another address, through the /go-to route handler. (A redirect returned from the
 * proxy is shortened to a relative path when both addresses run on one server, which loops.)
 */
const goTo = (req: NextRequest, url: string, status = 308) => {
  // The target travels in request headers: after a rewrite the handler sees the original URL.
  const headers = new Headers(req.headers);
  headers.set("x-kiota-go-to", url);
  headers.set("x-kiota-go-to-status", String(status));
  return internal(req, "/go-to", { request: { headers } });
};

/** Receipt share links sent to parents by SMS: /r/<16-character token>. */
const RECEIPT_PAGE = /^\/r\/([^/]+)$/;

/**
 * Whether a receipt share link exists. Checked here because a page cannot set its status code
 * once the static shell has been sent, and an unknown link must be a real HTTP 404.
 */
async function receiptLink(req: NextRequest, token: string) {
  if (!/^[A-Z2-9]{16}$/.test(token)) return notFound(req);
  const { platformDb } = await import("@/lib/db");
  const [row] = await platformDb.$queryRaw<{ found: boolean }[]>`
    SELECT app_receipt_public(${token}) IS NOT NULL AS found`;
  return row?.found ? NextResponse.next() : notFound(req);
}

/** Report card verification links (the QR code): kiota.app/v/<24-character code>. */
const VERIFY_PAGE = /^\/v\/([^/]+)$/;

async function verifyLink(req: NextRequest, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return notFound(req);
  const { platformDb } = await import("@/lib/db");
  const [row] = await platformDb.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM app_verify_report_card(${token})) AS found`;
  return row?.found ? internal(req, `/site/v/${token}`) : notFound(req);
}

export function proxy(req: NextRequest): NextResponse | Promise<NextResponse> {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/go-to") return NextResponse.next();

  if (host === APP_HOST) {
    if (hasPrefix(pathname, "/site")) return notFound(req);
    const receipt = RECEIPT_PAGE.exec(pathname);
    if (receipt) return receiptLink(req, receipt[1]);
    if (VERIFY_PAGE.test(pathname)) return goTo(req, `${SITE_URL}${pathname}`);
    if (pathname === "/") return goTo(req, `${APP_URL}/dashboard`, 307);
    if (SITE_PAGES.includes(pathname)) {
      return goTo(req, `${SITE_URL}${pathname}${search}`);
    }
    return NextResponse.next();
  }

  if (host === SITE_HOST) {
    if (APP_PREFIXES.some((p) => hasPrefix(pathname, p))) {
      return goTo(req, `${APP_URL}${pathname}${search}`);
    }
    if (hasPrefix(pathname, "/site")) return notFound(req);
    const verify = VERIFY_PAGE.exec(pathname);
    if (verify) return verifyLink(req, verify[1]);
    return internal(req, pathname === "/" ? "/site" : `/site${pathname}`);
  }

  // Any other host (a bare IP, a health check): nothing public is served.
  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  // Static files, metadata images and the health check skip the proxy.
  matcher: [
    "/((?!_next/|api/health|api/pay/|api/hooks/|brand/|sw\\.js|favicon\\.ico|icon|apple-icon|opengraph-image|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest).*)",
  ],
};
