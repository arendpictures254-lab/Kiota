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
  await owner.end();
}
