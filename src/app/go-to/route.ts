import { connection } from "next/server";
import { APP_URL, SITE_URL } from "@/lib/hosts";

/**
 * Cross-address redirects (kiota.app <-> app.kiota.app), used by the proxy. A redirect made in
 * the proxy itself is shortened to a relative path when both addresses run on one server, so
 * the proxy rewrites here instead. Only our own two addresses are allowed: no open redirect.
 */
export async function GET(req: Request) {
  await connection(); // always per request, never pre-rendered
  const to = req.headers.get("x-kiota-go-to") ?? "";
  const allowed = [SITE_URL, APP_URL].some(
    (origin) => to === origin || to.startsWith(`${origin}/`),
  );
  if (!allowed) return new Response("Not found", { status: 404 });
  const status = req.headers.get("x-kiota-go-to-status") === "307" ? 307 : 308;
  return new Response(null, { status, headers: { Location: to } });
}
