import "server-only";

import { createAppClient, scopedDb, withContext, type DbContext, type Tx } from "./db-core";

/**
 * The app's database access. Connects as the non-owner role `kiota_app`, so PostgreSQL
 * row-level security always applies. Never import the owner connection into app code.
 *
 * - `platformDb`: no school context. Sees no school-owned rows; used for sign-in and
 *   platform tables (otp_codes, sessions) and SECURITY DEFINER helpers.
 * - `scopedDb(ctx)`: a client extension that runs every query (including raw queries)
 *   in a transaction with app.user_id / app.school_id set. Good for reads.
 * - `withContext(ctx, fn)`: one transaction for several statements (writes + audit log).
 */
const globalForPrisma = globalThis as unknown as {
  kiotaAppDb?: ReturnType<typeof createAppClient>;
};

export const platformDb = globalForPrisma.kiotaAppDb ?? createAppClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.kiotaAppDb = platformDb;

export function db(ctx: DbContext) {
  return scopedDb(platformDb, ctx);
}

export function inContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(platformDb, ctx, fn);
}

export type { DbContext, Tx };
