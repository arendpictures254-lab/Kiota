/**
 * Local PostgreSQL without Docker (npm run db:local).
 * Runs real PostgreSQL 17 binaries from the embedded-postgres package, with the same
 * user, password, database and port as docker-compose.yml. Data lives in ./.pgdata.
 * Use either this or `npm run db:up` (Docker), not both: they share port 5432.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "kiota",
  password: "kiota_dev_password",
  port: 5432,
  persistent: true,
  onLog: () => {},
});

async function main() {
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("kiota");
  console.log("PostgreSQL running on localhost:5432 (database kiota). Ctrl+C to stop.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
