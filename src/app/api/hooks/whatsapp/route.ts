import { platformDb } from "@/lib/db";
import { applyDeliveryReport } from "@/lib/messaging/worker";
import { getWhatsAppDriver, verifyWhatsAppSignature, whatsappStatusOutcome } from "@/lib/whatsapp";

/** Meta's webhook check when the URL is saved: echo the challenge if the verify token matches. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    expected &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === expected
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "");
  }
  return new Response("Forbidden", { status: 403 });
}

type Webhook = {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id: string; status: string; errors?: { code?: number; title?: string }[] }[];
      };
    }[];
  }[];
};

/** Delivery statuses from WhatsApp. Signed by Meta with the app secret (X-Hub-Signature-256). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (
    !verifyWhatsAppSignature(
      raw,
      req.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET,
    )
  )
    return new Response("Forbidden", { status: 403 });
  let body: Webhook;
  try {
    body = JSON.parse(raw) as Webhook;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const provider = getWhatsAppDriver()?.name ?? "whatsapp";
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const outcome = whatsappStatusOutcome(s.status);
          if (!outcome) continue;
          const e = s.errors?.[0];
          await applyDeliveryReport(platformDb, {
            provider,
            providerMessageId: s.id,
            outcome,
            error: e ? `${e.title ?? "WhatsApp error"} (${e.code ?? "?"})` : null,
          });
        }
      }
    }
  } catch (err) {
    console.error("[messaging] WhatsApp webhook failed", err);
    return new Response("Try again", { status: 500 });
  }
  return new Response("OK");
}
