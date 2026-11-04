import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { templateLists } from "@/lib/import/run";
import { buildWorkbook } from "@/lib/import/workbook";

/** The import template, with this school's levels and classes in the dropdowns. */
export async function GET() {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.permissions.has("import.run")) return new Response("Not allowed.", { status: 403 });
  const lists = await templateLists(deps, await actorFor(ctx));
  const bytes = await buildWorkbook(lists);
  const name = `kiota-import-template-${ctx.school.shortName.toLowerCase()}.xlsx`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
