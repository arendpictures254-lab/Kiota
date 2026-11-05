/**
 * WhatsApp behind one interface. Only pre-approved templates are sent (WhatsApp does not allow
 * a business to start a chat with free text). Drivers:
 *  - "console" development: prints each message and appends it to .dev/whatsapp-outbox.log
 *  - "cloud"   Meta WhatsApp Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)
 *  - "off"     no WhatsApp: everything goes by SMS (the default in production until set up)
 * Delivery statuses come back on the signed webhook /api/hooks/whatsapp.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type WhatsAppTemplateMessage = {
  /** E.164 phone number. */
  to: string;
  template: string;
  language: "en" | "sw";
  /** Body parameters {{1}}, {{2}}... */
  params: string[];
  /** A PDF shown above the text (receipts). Meta downloads it from this public link. */
  document?: { url: string; filename: string } | null;
};

export type WhatsAppResult =
  | { ok: true; provider: string; providerMessageId: string }
  | { ok: false; provider: string; error: string; retryable: boolean };

export type WhatsAppDriver = {
  name: string;
  send(message: WhatsAppTemplateMessage): Promise<WhatsAppResult>;
};

const consoleDriver: WhatsAppDriver = {
  name: "whatsapp-console",
  async send(m) {
    const id = `wa-console-${randomUUID()}`;
    console.log(
      `\n[WhatsApp to ${m.to}] ${m.template} (${m.language}) ${JSON.stringify(m.params)}${m.document ? ` + ${m.document.url}` : ""}\n`,
    );
    const dir = path.resolve(".dev");
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, "whatsapp-outbox.log"),
      JSON.stringify({ id, ...m, at: new Date().toISOString() }) + "\n",
    );
    return { ok: true, provider: "whatsapp-console", providerMessageId: id };
  },
};

/** Meta error codes worth retrying: rate limits and temporary outages. */
const RETRYABLE = new Set([4, 80007, 130429, 131000, 131016, 131056, 133004]);

const cloudDriver: WhatsAppDriver = {
  name: "whatsapp",
  async send(m) {
    const version = process.env.WHATSAPP_API_VERSION || "v21.0";
    const components: unknown[] = [];
    if (m.document) {
      components.push({
        type: "header",
        parameters: [
          { type: "document", document: { link: m.document.url, filename: m.document.filename } },
        ],
      });
    }
    if (m.params.length) {
      components.push({
        type: "body",
        parameters: m.params.map((text) => ({ type: "text", text })),
      });
    }
    let res: Response;
    try {
      res = await fetch(
        `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: m.to.replace(/^\+/, ""),
            type: "template",
            template: { name: m.template, language: { code: m.language }, components },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (err) {
      return {
        ok: false,
        provider: "whatsapp",
        error: `Could not reach WhatsApp: ${(err as Error).message}`,
        retryable: true,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { code?: number; message?: string };
    };
    const id = json.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, provider: "whatsapp", providerMessageId: id };
    const code = json.error?.code ?? res.status;
    return {
      ok: false,
      provider: "whatsapp",
      error: `${json.error?.message ?? "WhatsApp refused the message"} (${code})`,
      retryable: res.status >= 500 || RETRYABLE.has(code),
    };
  },
};

type Env = Record<string, string | undefined>;

function driverName(env: Env) {
  return env.WHATSAPP_DRIVER || (env.NODE_ENV === "production" ? "off" : "console");
}

export function whatsappConfigProblem(env: Env = process.env): string | null {
  const name = driverName(env);
  if (!["console", "cloud", "off"].includes(name)) return `Unknown WHATSAPP_DRIVER "${name}"`;
  if (name === "cloud" && (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)) {
    return "WHATSAPP_DRIVER=cloud needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID";
  }
  if (name === "cloud" && !env.WHATSAPP_APP_SECRET) {
    return "WHATSAPP_DRIVER=cloud needs WHATSAPP_APP_SECRET to check delivery webhooks";
  }
  if (name === "console" && env.NODE_ENV === "production" && env.KIOTA_DEMO !== "1") {
    return 'WHATSAPP_DRIVER "console" must not be used in production (use cloud or off)';
  }
  return null;
}

let override: WhatsAppDriver | null | undefined;

/** Tests can replace the driver; `null` turns WhatsApp off. */
export function setWhatsAppDriverForTests(driver: WhatsAppDriver | null | undefined) {
  override = driver;
}

/** The driver, or null when WhatsApp is off (everything then goes by SMS). */
export function getWhatsAppDriver(): WhatsAppDriver | null {
  if (override !== undefined) return override;
  const problem = whatsappConfigProblem();
  if (problem) throw new Error(problem);
  const name = driverName(process.env);
  if (name === "off") return null;
  return name === "cloud" ? cloudDriver : consoleDriver;
}

export function whatsappEnabled() {
  try {
    return getWhatsAppDriver() !== null;
  } catch {
    return false;
  }
}

/** Meta signs each webhook body: X-Hub-Signature-256: sha256=<HMAC of the raw body>. */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice(7);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook status -> what it means for the message. */
export function whatsappStatusOutcome(status: string): "sent" | "delivered" | "failed" | null {
  if (status === "sent") return "sent";
  if (status === "delivered" || status === "read") return "delivered";
  if (status === "failed") return "failed";
  return null;
}
