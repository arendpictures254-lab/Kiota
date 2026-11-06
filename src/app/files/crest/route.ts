import { getSchoolContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { schoolCrest } from "@/lib/fees/receipts";

/** The current school's crest, for the app's sidebar (members of that school only). */
export async function GET() {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const school = await db(ctx.dbContext).school.findUnique({
    where: { id: ctx.school.id },
    select: { logoUrl: true },
  });
  const file = await schoolCrest(school?.logoUrl ?? null, ctx.school.id);
  if (!file) return new Response("No crest.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
