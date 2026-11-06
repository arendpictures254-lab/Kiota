import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { leaveoutPhoto } from "@/lib/leaveout/gate";

/** The student's photo on a gate pass: the gate, approvers and requesters only. */
export async function GET(_req: Request, { params }: RouteContext<"/files/leaveouts/[id]/photo">) {
  const { id } = await params;
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const file = await leaveoutPhoto(deps, await actorFor(ctx), id).catch(() => null);
  if (!file) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
