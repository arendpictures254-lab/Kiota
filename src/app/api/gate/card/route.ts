import { deps } from "@/lib/actions";
import { gateCard } from "@/lib/idcards/service";
import { gateActor, noStore } from "@/lib/leaveout/gate-route";

/** ?token=KC1...: a student ID card scanned at the gate (who it is, and any leave-out). */
export async function GET(req: Request) {
  const g = await gateActor();
  if ("response" in g) return g.response;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return Response.json(await gateCard(deps, g.actor, token), { headers: noStore });
}
