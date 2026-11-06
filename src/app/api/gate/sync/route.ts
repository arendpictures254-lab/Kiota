import { deps } from "@/lib/actions";
import { type GateEventInput, recordGateEvents } from "@/lib/leaveout/gate";
import { gateActor, noStore } from "@/lib/leaveout/gate-route";
import { kickMessageWorker } from "@/lib/messaging/worker-loop";

/** Exits and returns from the gate phone (now, or queued while it was offline). */
export async function POST(req: Request) {
  const g = await gateActor();
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => null)) as { events?: GateEventInput[] } | null;
  if (!body || !Array.isArray(body.events)) {
    return Response.json({ error: "Send { events: [...] }." }, { status: 400 });
  }
  const results = await recordGateEvents(deps, g.actor, body.events);
  kickMessageWorker();
  return Response.json({ results }, { headers: noStore });
}
