import { connection } from "next/server";
import { platformDb } from "@/lib/db";

/**
 * Health check for Docker and the web server: 200 when the app can reach the database.
 * Says nothing about schools or users.
 */
export async function GET() {
  await connection();
  try {
    await platformDb.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "database unavailable" }, { status: 503 });
  }
}
