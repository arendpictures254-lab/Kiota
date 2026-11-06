import { deps } from "@/lib/actions";
import { gateBundle } from "@/lib/leaveout/gate";
import { gateActor, noStore } from "@/lib/leaveout/gate-route";

/** Today's and tomorrow's passes, photos and the public key, for the gate phone to work offline. */
export async function GET() {
  const g = await gateActor();
  if ("response" in g) return g.response;
  return Response.json(await gateBundle(deps, g.actor), { headers: noStore });
}
