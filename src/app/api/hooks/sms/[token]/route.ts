import { timingSafeEqual } from "node:crypto";
import { sha256 } from "@/lib/crypto";
import { platformDb } from "@/lib/db";
import { applyDeliveryReport } from "@/lib/messaging/worker";
import { atDeliveryOutcome } from "@/lib/sms/africastalking-driver";
import { getSmsDriver } from "@/lib/sms";

/**
 * Africa's Talking delivery reports (set this URL in the AT dashboard:
 * https://app.kiota.app/api/hooks/sms/<SMS_CALLBACK_TOKEN>). Reports are not signed, so the
 * secret token in the URL is checked, and a report can only change a message Kiota itself sent
 * (matched on the provider's message id). Repeats change nothing.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/hooks/sms/[token]">) {
  const { token } = await params;
  const expected = process.env.SMS_CALLBACK_TOKEN;
  if (!expected || expected.length < 20) return new Response("Not found", { status: 404 });
  if (!timingSafeEqual(Buffer.from(sha256(token), "hex"), Buffer.from(sha256(expected), "hex")))
    return new Response("Not found", { status: 404 });

  const text = await req.text();
  let fields: Record<string, string> = {};
  try {
    fields = req.headers.get("content-type")?.includes("json")
      ? (JSON.parse(text) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(text));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!fields.id || !fields.status) return new Response("OK");
  try {
    await applyDeliveryReport(platformDb, {
      provider: getSmsDriver().name,
      providerMessageId: String(fields.id),
      outcome: atDeliveryOutcome(String(fields.status)),
      error: fields.failureReason
        ? `${fields.status}: ${fields.failureReason}`
        : String(fields.status),
    });
  } catch (err) {
    console.error("[messaging] delivery report failed", err);
    return new Response("Try again", { status: 500 });
  }
  return new Response("OK");
}
