import { platformDb } from "@/lib/db";
import { handleC2BValidation } from "@/lib/mpesa/service";
import { mpesaRoute } from "@/lib/mpesa/route";

/** Safaricom Daraja callback. Public; the secret token in the URL identifies the school. */
export const POST = mpesaRoute((token) => handleC2BValidation(platformDb, token));
