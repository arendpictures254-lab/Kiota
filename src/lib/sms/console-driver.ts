import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SmsDriver } from "./index";

/**
 * Development driver: prints each SMS to the server console and appends it to
 * .dev/sms-outbox.log (one JSON object per line; end-to-end tests read codes from it).
 */
export const consoleDriver: SmsDriver = {
  name: "console",
  async send({ to, text }) {
    console.log(`\n[SMS to ${to}] ${text}\n`);
    const dir = path.resolve(".dev");
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, "sms-outbox.log"),
      JSON.stringify({ to, text, at: new Date().toISOString() }) + "\n",
    );
  },
};
