import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { exportFeesWorkbook } from "@/lib/fees/reports";

/** Everything about fees in one Excel workbook, for the auditor (fees.reports). */
export async function GET() {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.permissions.has("fees.reports")) return new Response("Not allowed.", { status: 403 });
  const bytes = await exportFeesWorkbook(deps, await actorFor(ctx));
  const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kiota-fees-${ctx.school.shortName.toLowerCase()}-${day}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
