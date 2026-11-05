import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SmsDriver } from "./index";
import { countSms } from "@/lib/messaging/units";

/**
 * Development driver: prints each SMS to the server console and appends it to
 * .dev/sms-outbox.log (one JSON object per line; end-to-end tests read codes from it).
 * Each message gets an id, so `npm run sms:simulate` can send fake delivery reports for it.
 */
export const consoleDriver: SmsDriver = {
  name: "console",
  async send({ to, text, from }) {
    const id = `console-${randomUUID()}`;
    console.log(`\n[SMS to ${to}${from ? ` from ${from}` : ""}] ${text}\n`);
    const dir = path.resolve(".dev");
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, "sms-outbox.log"),
      JSON.stringify({ id, to, from: from ?? null, text, at: new Date().toISOString() }) + "\n",
    );
    return { ok: true, provider: "console", providerMessageId: id, units: countSms(text).units };
  },
};
