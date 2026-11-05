import { getCurrentUser } from "@/lib/auth/context";
import { scopedDb } from "@/lib/db-core";
import { platformDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/** A child's photo, for that child's own parent only (checked in the database). */
export async function GET(_req: Request, { params }: RouteContext<"/parent/photo/[linkId]">) {
  const { linkId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) return new Response("Not found.", { status: 404 });
  const [row] = await scopedDb(platformDb, { userId: user.id, schoolId: null }).$queryRaw<
    { key: string | null }[]
  >`SELECT app_parent_child_photo(${linkId}::uuid) AS key`;
  const file = row?.key ? await getStorage().get(row.key) : null;
  if (!file) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=86400" },
  });
}
