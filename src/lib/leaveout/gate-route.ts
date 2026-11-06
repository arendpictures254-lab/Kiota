import "server-only";

import { actorFor } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import type { Actor } from "@/lib/service-kit";
import { canUseGate } from "./gate";

/** The gate API's caller: a signed-in guard (gate.scan) or boarding staff, or an error response. */
export async function gateActor(): Promise<{ actor: Actor } | { response: Response }> {
  const ctx = await getSchoolContext();
  if (!ctx) return { response: Response.json({ error: "Sign in first." }, { status: 401 }) };
  const actor = await actorFor(ctx);
  if (!canUseGate(actor))
    return { response: Response.json({ error: "Not allowed." }, { status: 403 }) };
  return { actor };
}

export const noStore = { "Cache-Control": "no-store" };
