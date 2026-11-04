/**
 * SMS sending behind one interface. Drivers: "console" (development) for now;
 * Africa's Talking will be added later as another driver.
 */
import { consoleDriver } from "./console-driver";

export type SmsMessage = {
  /** E.164 phone number. */
  to: string;
  text: string;
};

export type SmsDriver = {
  name: string;
  send(message: SmsMessage): Promise<void>;
};

const drivers: Record<string, SmsDriver> = {
  console: consoleDriver,
};

export function getSmsDriver(): SmsDriver {
  const name = process.env.SMS_DRIVER ?? "console";
  const driver = drivers[name];
  if (!driver) throw new Error(`Unknown SMS_DRIVER "${name}"`);
  // Never print codes in production, except a local end-to-end run that opts in explicitly.
  if (
    name === "console" &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_CONSOLE_SMS !== "1"
  ) {
    throw new Error('SMS_DRIVER "console" must not be used in production');
  }
  return driver;
}

export async function sendSms(message: SmsMessage): Promise<void> {
  await getSmsDriver().send(message);
}
