/**
 * Prepares the `kiota_test` database for the "db" Vitest project: creates it if needed,
 * applies migrations as the owner, syncs the permission catalogue and enables kiota_app.
 */
import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { createClient } from "../src/lib/db-core";
import { enableAppRoleLogin, syncCatalog } from "../prisma/setup";

export default async function setup(project: TestProject) {
  const env = project.config.env as Record<string, string>;
  const ownerUrl = env.DATABASE_URL;
  const appUrl = env.APP_DATABASE_URL;
  if (!ownerUrl.includes("_test"))
    throw new Error(`Refusing to set up a non-test database: ${ownerUrl}`);
  const dbName = new URL(ownerUrl).pathname.slice(1);

  // Connect to the default database to create the test database.
  const adminUrl = new URL(ownerUrl);
  adminUrl.pathname = "/postgres";
  const admin = createClient(adminUrl.toString());
  try {
    const exists = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: "pipe",
  });

  const owner = createClient(ownerUrl);
  try {
    await enableAppRoleLogin(owner, appUrl);
    await syncCatalog(owner);
  } finally {
    await owner.$disconnect();
  }
}
