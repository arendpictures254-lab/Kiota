/**
 * Host-based routing: one Next.js app serves two addresses.
 *  - Site (kiota.app):     /, /features, ... are served from src/app/site/*.
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

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/go-to") return NextResponse.next();

  if (host === APP_HOST) {
    if (hasPrefix(pathname, "/site")) return notFound(req);
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
    return internal(req, pathname === "/" ? "/site" : `/site${pathname}`);
  }

  // Any other host (a bare IP, a health check): nothing public is served.
  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  // Static files, metadata images and the health check skip the proxy.
  matcher: [
    "/((?!_next/|api/health|api/pay/|brand/|favicon\\.ico|icon|apple-icon|opengraph-image|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest).*)",
  ],
};
