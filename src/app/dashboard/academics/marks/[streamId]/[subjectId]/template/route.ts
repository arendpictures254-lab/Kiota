import { markTemplate } from "@/lib/academics/marks";
import { canSeeAcademics } from "@/lib/academics/setup";
import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { ValidationError } from "@/lib/service-kit";

/** The Excel template for one stream, subject and assessment (filled with the students). */
export async function GET(
  req: Request,
  { params }: RouteContext<"/dashboard/academics/marks/[streamId]/[subjectId]/template">,
) {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!canSeeAcademics(ctx.permissions)) return new Response("Not allowed.", { status: 403 });
  const { streamId, subjectId } = await params;
  const url = new URL(req.url);
  try {
    const t = await markTemplate(deps, await actorFor(ctx), {
      termId: url.searchParams.get("term") ?? "",
      streamId,
      subjectId,
      assessmentId: url.searchParams.get("assessment") ?? "",
    });
    return new Response(new Uint8Array(t.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${t.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) return new Response(err.message, { status: 404 });
    throw err;
  }
}
