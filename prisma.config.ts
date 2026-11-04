import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrations, seed) connects as the database OWNER via DATABASE_URL.
// The running app uses APP_DATABASE_URL (role kiota_app) instead; see src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
