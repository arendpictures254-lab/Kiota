import { timingSafeEqual } from "node:crypto";
import { sha256 } from "@/lib/crypto";
import { platformDb } from "@/lib/db";
import { smsCollectorReply } from "@/lib/leaveout/parent";

/**
 * Incoming SMS from Africa's Talking (set this URL in the AT dashboard as the incoming messages
 * callback: https://app.kiota.app/api/hooks/sms-in/<SMS_CALLBACK_TOKEN>). Used for a parent's
 * reply approving a leave-out collector: "YES 1234" / "NO 1234" (or NDIYO / HAPANA). The reply
 * only counts from a phone that is a guardian of that child; anything else is ignored.
 */
export async function POST(req: Request, { params }: RouteContext<"/api/hooks/sms-in/[token]">) {
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
  if (fields.from && fields.text) {
    try {
      await smsCollectorReply(platformDb, String(fields.from), String(fields.text));
    } catch (err) {
      console.error("[leaveouts] SMS reply failed", err);
      return new Response("Try again", { status: 500 });
    }
  }
  return new Response("OK");
}
