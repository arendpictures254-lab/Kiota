import { platformDb } from "@/lib/db";
import { receiptNo } from "@/lib/fees/allocation";
import { a4ReceiptPdf } from "@/lib/fees/pdf";
import { getPublicReceipt, schoolCrest } from "@/lib/fees/receipts";

/** PDF of a shared receipt (no sign-in; the token is the secret). */
export async function GET(_req: Request, { params }: RouteContext<"/r/[token]/pdf">) {
  const { token } = await params;
  const r = await getPublicReceipt(platformDb, token);
  if (!r) return new Response("Not found.", { status: 404 });
  const crest = await schoolCrest(r.school.logoKey, r.school.id);
  const pdf = await a4ReceiptPdf(r, crest?.bytes ?? null);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${receiptNo(r.number)}.pdf"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
