import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

// End-to-end tests run their own dev server against a separate, freshly seeded database
// (`kiota_e2e`), so they never touch your development data.
const PORT = 3101;

function e2eDb(url: string | undefined) {
  if (!url) return "";
  const u = new URL(url);
  u.pathname = "/kiota_e2e";
  return u.toString();
}

export const E2E_ENV = {
  DATABASE_URL: e2eDb(process.env.DATABASE_URL),
  APP_DATABASE_URL: e2eDb(process.env.APP_DATABASE_URL),
  AUTH_SECRET: "e2e-secret",
  SMS_DRIVER: "console",
  SITE_URL: `http://localhost:${PORT}`,
  APP_URL: `http://app.localhost:${PORT}`,
  ALLOW_CONSOLE_SMS: "1",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    // The app address; site tests use SITE (see e2e/site.spec.ts).
    baseURL: `http://app.localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Mobile first: parents and most staff use mid-range Android phones.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // A production build: fast and close to real use (dev mode compiles routes on demand).
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: E2E_ENV,
  },
});
