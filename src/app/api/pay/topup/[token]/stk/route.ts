import { platformDb } from "@/lib/db";
import { handleTopupCallback } from "@/lib/messaging/wallet";
import { mpesaRoute } from "@/lib/mpesa/route";

/**
 * Daraja STK callback for messaging wallet top-ups (Arend Studio's own Paybill). Public; the
 * secret PLATFORM_MPESA_CALLBACK_TOKEN in the URL is checked, and every top-up is confirmed
 * with Safaricom before it is credited.
 */
export const POST = mpesaRoute((token, body) => handleTopupCallback(platformDb, token, body));
