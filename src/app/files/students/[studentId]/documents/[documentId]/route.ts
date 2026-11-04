import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { readStudentFile } from "@/lib/students/service";

/** A student's document, only for staff who may see that student. */
export async function GET(
  _req: Request,
  { params }: RouteContext<"/files/students/[studentId]/documents/[documentId]">,
) {
  const { studentId, documentId } = await params;
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (![studentId, documentId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
    return new Response("Not found.", { status: 404 });
  }
  const file = await readStudentFile(deps, await actorFor(ctx), studentId, { documentId }).catch(
    () => null,
  );
  if (!file) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
