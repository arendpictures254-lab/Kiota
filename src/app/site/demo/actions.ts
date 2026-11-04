"use server";

import { clientIp } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import {
  RateLimitedError,
  hashIp,
  isBot,
  parseDemoRequest,
  submitDemoRequest,
} from "@/lib/demo/service";
import { ValidationError } from "@/lib/service-kit";

export type DemoState = { error?: string; field?: string; done?: boolean };

export async function requestDemoAction(_s: DemoState, form: FormData): Promise<DemoState> {
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  // Bots fill the hidden field: thank them and store nothing.
  if (isBot(raw)) return { done: true };
  try {
    const input = parseDemoRequest(raw);
    await submitDemoRequest(
      platformDb,
      input,
      hashIp(await clientIp(), process.env.AUTH_SECRET ?? ""),
    );
    return { done: true };
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    if (err instanceof RateLimitedError) {
      return {
        error:
          "We have received several requests from you already. We'll be in touch, or chat with us on WhatsApp.",
      };
    }
    throw err;
  }
}
