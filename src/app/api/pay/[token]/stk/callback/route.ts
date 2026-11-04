import { platformDb } from "@/lib/db";
import { handleStkCallback } from "@/lib/mpesa/service";
import { mpesaRoute } from "@/lib/mpesa/route";

/** Safaricom Daraja callback. Public; the secret token in the URL identifies the school. */
export const POST = mpesaRoute((token, body) => handleStkCallback(platformDb, token, body));
