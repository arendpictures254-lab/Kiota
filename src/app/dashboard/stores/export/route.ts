import { actorFor, deps } from "@/lib/actions";
import { isoDay, nairobiDate, parseDay } from "@/lib/attendance/rules";
import { getSchoolContext } from "@/lib/auth/context";
import { canSeeStoreReports, exportStoresWorkbook } from "@/lib/stores/reports";

/** Stores reports for a period in one Excel workbook (stores.reports). */
export async function GET(req: Request) {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!canSeeStoreReports(ctx.permissions)) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const range = {
    from: parseDay(url.searchParams.get("from")),
    to: parseDay(url.searchParams.get("to")),
  };
  const bytes = await exportStoresWorkbook(deps, await actorFor(ctx), range);
  const name = `kiota-stores-${ctx.school.shortName.toLowerCase()}-${isoDay(range.to ?? nairobiDate(new Date()))}.xlsx`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
