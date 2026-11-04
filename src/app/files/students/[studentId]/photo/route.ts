import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { readStudentFile } from "@/lib/students/service";

/** A student's photo, only for staff who may see that student (row-level security decides). */
export async function GET(
  _req: Request,
  { params }: RouteContext<"/files/students/[studentId]/photo">,
) {
  const { studentId } = await params;
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) return new Response("Not found.", { status: 404 });
  const file = await readStudentFile(deps, await actorFor(ctx), studentId, { photo: true }).catch(
    () => null,
  );
  if (!file) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
