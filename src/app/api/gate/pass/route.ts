import { deps } from "@/lib/actions";
import { gatePass, searchGatePasses } from "@/lib/leaveout/gate";
import { gateActor, noStore } from "@/lib/leaveout/gate-route";

/** ?token=KP1...: one pass, fresh. ?q=name: today's passes by name or admission number. */
export async function GET(req: Request) {
  const g = await gateActor();
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token)
    return Response.json({ pass: await gatePass(deps, g.actor, token) }, { headers: noStore });
  const q = url.searchParams.get("q") ?? "";
  return Response.json({ passes: await searchGatePasses(deps, g.actor, q) }, { headers: noStore });
}
