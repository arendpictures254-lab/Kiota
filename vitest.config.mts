import react from "@vitejs/plugin-react";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

/** Same server and credentials as .env, but the separate database `kiota_test`. */
function testDb(url: string | undefined) {
  if (!url) return "";
  const u = new URL(url);
  u.pathname = "/kiota_test";
  return u.toString();
}

const dbEnv = {
  DATABASE_URL: testDb(process.env.DATABASE_URL),
  APP_DATABASE_URL: testDb(process.env.APP_DATABASE_URL),
  AUTH_SECRET: "test-secret",
  CREDENTIALS_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  MPESA_SIM_DIR: ".storage-test/mpesa-sim",
};

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        // Tests against a real PostgreSQL (needs `npm run db:up` or `npm run db:local`).
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["./tests/db-global-setup.ts"],
          env: dbEnv,
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
