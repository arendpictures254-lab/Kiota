import type { SmsDriver, SmsResult } from "./index";

/**
 * Africa's Talking bulk SMS (https://developers.africastalking.com/docs/sms/sending/bulk).
 *  AT_ENVIRONMENT  "sandbox" (default) or "live"
 *  AT_USERNAME     the app's username ("sandbox" in the sandbox)
 *  AT_API_KEY      the app's API key
 * The sender ID ("from") must be approved for the account by Africa's Talking and the networks;
 * an unapproved one is refused (status 402) and the message fails without retrying.
 * Delivery reports arrive later at /api/hooks/sms/<SMS_CALLBACK_TOKEN> (set in the AT dashboard).
 */

const BASE = {
  sandbox: "https://api.sandbox.africastalking.com",
  live: "https://api.africastalking.com",
} as const;

/** Recipient status codes that mean "accepted for delivery". */
const ACCEPTED = new Set([100, 101, 102]);
/** Worth trying again later: risk hold, Arend's AT balance empty, routing or gateway trouble. */
const RETRYABLE = new Set([401, 405, 407, 500, 501, 502]);

type AtResponse = {
  SMSMessageData?: {
    Message?: string;
    Recipients?: {
      statusCode: number;
      number: string;
      status: string;
      cost?: string;
      messageId?: string;
      messageParts?: number;
    }[];
  };
};

export const africasTalkingDriver: SmsDriver = {
  name: "africastalking",
  async send({ to, text, from }): Promise<SmsResult> {
    const env = process.env.AT_ENVIRONMENT === "live" ? "live" : "sandbox";
    const body = new URLSearchParams({
      username: process.env.AT_USERNAME ?? "",
      to,
      message: text,
    });
    if (from) body.set("from", from);
    let res: Response;
    try {
      res = await fetch(`${BASE[env]}/version1/messaging`, {
        method: "POST",
        headers: {
          apiKey: process.env.AT_API_KEY ?? "",
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return {
        ok: false,
        provider: "africastalking",
        error: `Could not reach Africa's Talking: ${(err as Error).message}`,
        retryable: true,
      };
    }
    const json = (await res.json().catch(() => ({}))) as AtResponse;
    if (!res.ok) {
      return {
        ok: false,
        provider: "africastalking",
        error: `Africa's Talking answered ${res.status}: ${json.SMSMessageData?.Message ?? "no details"}`,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const r = json.SMSMessageData?.Recipients?.[0];
    if (!r) {
      return {
        ok: false,
        provider: "africastalking",
        error: json.SMSMessageData?.Message ?? "No recipient in the answer",
        retryable: false,
      };
    }
    if (ACCEPTED.has(r.statusCode) && r.messageId) {
      return {
        ok: true,
        provider: "africastalking",
        providerMessageId: r.messageId,
        units: r.messageParts,
      };
    }
    return {
      ok: false,
      provider: "africastalking",
      error: `${r.status} (${r.statusCode})`,
      retryable: RETRYABLE.has(r.statusCode),
    };
  },
};

/** Delivery report statuses: final success, final failure, or still on the way. */
export function atDeliveryOutcome(status: string): "delivered" | "failed" | "pending" {
  if (status === "Success") return "delivered";
  if (["Failed", "Rejected", "AbsentSubscriber", "Expired"].includes(status)) return "failed";
  return "pending"; // Sent, Submitted, Buffered
}
