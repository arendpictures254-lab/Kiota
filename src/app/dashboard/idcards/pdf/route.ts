import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { cardSheetsPdf, singleCardsPdf } from "@/lib/idcards/pdf";
import { cardsForPrint } from "@/lib/idcards/service";
import { ValidationError } from "@/lib/service-kit";

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/**
 * Student ID cards as a PDF (idcards.print): format=a4 (sheets with crop marks) or format=cr80
 * (one card per page, for PVC card printers). Students without a card are issued one.
 */
export async function GET(req: Request) {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.permissions.has("idcards.print")) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const student = uuid(url.searchParams.get("student"));
  try {
    const data = await cardsForPrint(deps, await actorFor(ctx), {
      streamId: uuid(url.searchParams.get("stream")),
      classId: uuid(url.searchParams.get("class")),
      studentIds: student ? [student] : undefined,
    });
    if (!data.cards.length) return new Response("No students to print.", { status: 404 });
    const a4 = url.searchParams.get("format") !== "cr80";
    const bytes = a4
      ? await cardSheetsPdf(data.school, data.cards)
      : await singleCardsPdf(data.school, data.cards);
    const name = `kiota-id-cards-${ctx.school.shortName.toLowerCase()}-${a4 ? "a4" : "cr80"}.pdf`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) return new Response(err.message, { status: 400 });
    throw err;
  }
}
