import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { statementPdf } from "@/lib/fees/pdf";
import { getStatement, schoolCrest } from "@/lib/fees/receipts";

/** Fee statement PDF for one student (staff who can see fees and that student). */
export async function GET(
  _req: Request,
  { params }: RouteContext<"/files/statements/[studentId]">,
) {
  const { studentId } = await params;
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) return new Response("Not found.", { status: 404 });
  const s = await getStatement(deps, await actorFor(ctx), studentId).catch(() => null);
  if (!s) return new Response("Not found.", { status: 404 });
  const crest = await schoolCrest(s.school.logoKey, s.school.id);
  const pdf = await statementPdf(s, crest?.bytes ?? null);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="statement-${s.student.admissionNumber.replace(/[^A-Za-z0-9-]/g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
