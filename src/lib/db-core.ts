/**
 * Database plumbing shared by the app (src/lib/db.ts) and tests. No "server-only" here so
 * Vitest can import it; app code should import from "@/lib/db" instead.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { guardEnabled, withSchoolGuard } from "./db-guard";

export type DbContext = {
  /** The signed-in user. */
  userId: string | null;
  /** The school the request is working in. Null = no school: sees no school rows. */
  schoolId: string | null;
};

export type Tx = Prisma.TransactionClient;

export function createClient(connectionString: string | undefined) {
  if (!connectionString) {
    throw new Error("Database URL is not set. Copy .env.example to .env.");
  }
  // Pin sessions to UTC: the pg adapter sends timestamps without an offset, so a server
  // running in local time (e.g. Africa/Nairobi) would otherwise store them 3 hours off.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }),
  });
}

/**
 * Client for the non-owner app role (RLS always applies). In development and tests every query
 * on a school-owned model must also name the school (src/lib/db-guard.ts).
 */
export function createAppClient() {
  const client = createClient(process.env.APP_DATABASE_URL);
  return guardEnabled() ? withSchoolGuard(client) : client;
}

function setContextSql(ctx: DbContext) {
  return Prisma.sql`SELECT set_config('app.user_id', ${ctx.userId ?? ""}, true),
                           set_config('app.school_id', ${ctx.schoolId ?? ""}, true)`;
}

/**
 * Prisma client extension: every operation, including $queryRaw / $executeRaw, runs in a
 * transaction that first sets app.user_id and app.school_id. The RLS policies read them.
 */
export function scopedDb(base: PrismaClient, ctx: DbContext) {
  return base.$extends({
    name: "kiota-school-context",
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await base.$transaction([
          base.$queryRaw(setContextSql(ctx)),
          query(args),
        ]);
        return result;
      },
    },
  });
}

/** Run several statements in one transaction with the context set. */
export async function withContext<T>(
  base: PrismaClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return base.$transaction(
    async (tx) => {
      await tx.$queryRaw(setContextSql(ctx));
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 10_000, maxWait: 10_000 },
  );
}
