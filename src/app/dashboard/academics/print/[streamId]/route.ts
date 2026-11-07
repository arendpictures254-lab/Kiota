import { reportCardsPdf } from "@/lib/academics/pdf";
import { reportCards } from "@/lib/academics/reportcards";
import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permissions";

/** A stream's report cards as one A4 PDF (admission-number order), or one student's. */
export async function GET(
  req: Request,
  { params }: RouteContext<"/dashboard/academics/print/[streamId]">,
) {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.permissions.has("reports.print")) return new Response("Not allowed.", { status: 403 });
  const { streamId } = await params;
  const url = new URL(req.url);
  try {
    const bundle = await reportCards(deps, await actorFor(ctx), {
      termId: url.searchParams.get("term") ?? "",
      streamId,
      studentId: url.searchParams.get("student") ?? undefined,
      withImages: true,
    });
    const pdf = await reportCardsPdf(bundle);
    const who = bundle.cards.length === 1 ? bundle.cards[0].admissionNumber : bundle.stream.name;
    const name = `report-cards-${who}-${bundle.term.label}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Not allowed.", { status: 403 });
    console.error("[academics] report cards PDF failed", err);
    return new Response("Report cards not found.", { status: 404 });
  }
}
