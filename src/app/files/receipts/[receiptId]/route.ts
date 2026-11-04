import { actorFor, deps } from "@/lib/actions";
import { getSchoolContext } from "@/lib/auth/context";
import { receiptNo } from "@/lib/fees/allocation";
import { a4ReceiptPdf, thermalReceiptPdf } from "@/lib/fees/pdf";
import { getReceiptView, schoolCrest } from "@/lib/fees/receipts";

/** Receipt PDF (?layout=thermal|a4) for signed-in staff who can see fees. */
export async function GET(req: Request, { params }: RouteContext<"/files/receipts/[receiptId]">) {
  const { receiptId } = await params;
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) return new Response("Not found.", { status: 404 });
  const r = await getReceiptView(deps, await actorFor(ctx), receiptId).catch(() => null);
  if (!r) return new Response("Not found.", { status: 404 });
  const crest = await schoolCrest(r.school.logoKey, r.school.id);
  const thermal = new URL(req.url).searchParams.get("layout") !== "a4";
  const pdf = thermal
    ? await thermalReceiptPdf(r, crest?.bytes ?? null)
    : await a4ReceiptPdf(r, crest?.bytes ?? null);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${receiptNo(r.number)}${thermal ? "-thermal" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
