/**
 * Creates and seeds the `kiota_e2e` database, and clears old sign-in codes so the
 * per-phone rate limit never trips between runs.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_ENV } from "../playwright.config";

export default async function globalSetup() {
  const ownerUrl = E2E_ENV.DATABASE_URL;
  if (!ownerUrl.includes("kiota_e2e")) throw new Error("Refusing to seed a non-e2e database");

  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'kiota_e2e'");
  if (!rowCount) await admin.query('CREATE DATABASE "kiota_e2e"');
  await admin.end();

  const env = { ...process.env, ...E2E_ENV };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("DELETE FROM otp_codes");
  await owner.query("DELETE FROM demo_requests");
  // The parent portal journey confirms Wanjiku's Milima child: make it wait again every run,
  // and keep her in English.
  await owner.query(`
    UPDATE parent_link_confirmations SET status = 'pending', confirmed_at = NULL, declined_at = NULL
    WHERE guardian_link_id IN (
      SELECT g.id FROM guardian_links g JOIN users u ON u.id = g.user_id
      JOIN schools s ON s.id = g.school_id
      WHERE u.phone = '+254744000001' AND s.name = 'Milima School')`);
  await owner.query(
    "UPDATE users SET preferred_language = 'en' WHERE phone IN ('+254744000001', '+254711000003')",
  );
  await owner.query(
    "UPDATE guardian_links SET language = 'en' WHERE user_id IN (SELECT id FROM users WHERE phone = '+254744000001')",
  );
  await owner.query("DELETE FROM sessions");
  await owner.end();
}
