import { APP_HOST, SITE_URL } from "@/lib/hosts";

/** The public site may be indexed; the app (app.kiota.app) never. */
export async function GET(req: Request) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const body =
    host === APP_HOST
      ? "User-agent: *\nDisallow: /\n"
      : `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
