/**
 * SMS sending behind one interface. Drivers:
 *  - "console"        development: prints each SMS and appends it to .dev/sms-outbox.log
 *  - "africastalking" Africa's Talking bulk SMS (AT_ENVIRONMENT=sandbox or live)
 *
 * Two kinds of SMS:
 *  - school messages (sendSms with the school's sender ID), queued and paid from the school's
 *    wallet by src/lib/messaging;
 *  - platform messages (sendPlatformSms: sign-in codes, welcome and low-balance alerts) under
 *    Kiota's own sender ID, paid by Arend Studio and never charged to a school.
 */
import { africasTalkingDriver } from "./africastalking-driver";
import { consoleDriver } from "./console-driver";
import { toPlainSms } from "@/lib/messaging/units";

export type SmsMessage = {
  /** E.164 phone number. */
  to: string;
  text: string;
  /** Sender ID. Null = the provider's default. */
  from?: string | null;
};

export type SmsResult =
  | {
      ok: true;
      provider: string;
      providerMessageId: string;
      /** Units the provider billed, when it says. */
      units?: number;
    }
  | {
      ok: false;
      provider: string;
      error: string;
      /** Try again later (network, provider busy) rather than giving up. */
      retryable: boolean;
    };

export type SmsDriver = {
  name: string;
  send(message: SmsMessage): Promise<SmsResult>;
};

const drivers: Record<string, SmsDriver> = {
  console: consoleDriver,
  africastalking: africasTalkingDriver,
};

type Env = Record<string, string | undefined>;

/**
 * What is wrong with the SMS settings, or null. Production refuses to start with a problem
 * (src/instrumentation.ts), so a staging setting can never reach real users by accident.
 */
export function smsConfigProblem(env: Env = process.env): string | null {
  const name = env.SMS_DRIVER || "console";
  if (!drivers[name]) return `Unknown SMS_DRIVER "${name}"`;
  if (name === "africastalking" && (!env.AT_USERNAME || !env.AT_API_KEY)) {
    return "SMS_DRIVER=africastalking needs AT_USERNAME and AT_API_KEY";
  }
  if (env.NODE_ENV === "production") {
    const demo = env.KIOTA_DEMO === "1";
    if (env.ALLOW_CONSOLE_SMS === "1" && !demo) {
      return "ALLOW_CONSOLE_SMS=1 is for development and demo servers only (set KIOTA_DEMO=1 on a demo server)";
    }
    if (name === "console" && !(env.ALLOW_CONSOLE_SMS === "1" && demo)) {
      return 'SMS_DRIVER "console" must not be used in production (use africastalking)';
    }
  }
  return null;
}

let override: SmsDriver | null = null;

/** Tests can replace the driver (e.g. to make the provider fail). */
export function setSmsDriverForTests(driver: SmsDriver | null) {
  override = driver;
}

export function getSmsDriver(): SmsDriver {
  if (override) return override;
  const problem = smsConfigProblem();
  if (problem) throw new Error(problem);
  return drivers[process.env.SMS_DRIVER || "console"];
}

/** The sender ID for Kiota's own messages (sign-in codes): SMS_PLATFORM_SENDER_ID, e.g. KIOTA. */
export function platformSenderId(): string | null {
  return process.env.SMS_PLATFORM_SENDER_ID || null;
}

/** Every SMS goes out as plain GSM-7 where possible: curly quotes and long dashes are replaced. */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  return getSmsDriver().send({ ...message, text: toPlainSms(message.text) });
}

/**
 * A platform message under Kiota's sender ID, paid by Arend Studio. Throws if it was not
 * accepted, so a sign-in code that never left is reported to the person.
 */
export async function sendPlatformSms(message: { to: string; text: string }): Promise<void> {
  const result = await sendSms({ ...message, from: platformSenderId() });
  if (!result.ok) throw new Error(`SMS not sent: ${result.error}`);
}
