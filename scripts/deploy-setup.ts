/**
 * Runs on every deploy, after `prisma migrate deploy`, as the database OWNER:
 *  - syncs the permission catalogue and built-in roles,
 *  - lets the app role kiota_app log in with the password in APP_DATABASE_URL.
 * Safe to run again. Used by the "migrate" service in docker-compose.prod.yml.
 */
import "dotenv/config";
import { enableAppRoleLogin, syncCatalog } from "../prisma/setup";
import { createClient } from "../src/lib/db-core";

async function main() {
  const owner = createClient(process.env.DATABASE_URL);
  try {
    await enableAppRoleLogin(owner, process.env.APP_DATABASE_URL ?? "");
    await syncCatalog(owner);
    console.log("Deploy setup done: catalogue synced, kiota_app can log in.");
  } finally {
    await owner.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
