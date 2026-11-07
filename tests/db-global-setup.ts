/**
 * Prepares the `kiota_test` database for the "db" Vitest project: makes it again from empty
 * on every run (tests never depend on what an earlier run left behind, and leftovers made random
 * test data collide), applies migrations as the owner, syncs the permission catalogue and enables
 * kiota_app.
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
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
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
