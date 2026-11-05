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
  // A production build printing SMS to the console is only allowed on a demo server.
  KIOTA_DEMO: "1",
  // Messages go out at any hour of a test run, and delivery reports come from sms:simulate.
  QUIET_HOURS: "off",
  SMS_CALLBACK_TOKEN: "e2e-sms-callback-token-0123456789",
  WHATSAPP_DRIVER: "off",
  // Wallet top-ups go to a simulated Arend Studio Paybill.
  PLATFORM_MPESA_ENVIRONMENT: "simulator",
  PLATFORM_MPESA_SHORTCODE: "600999",
  PLATFORM_MPESA_CALLBACK_TOKEN: "e2e-platform-topup-token-0123456789",
  // Several tests sign in as the same seeded people.
  OTP_MAX_PER_WINDOW: "50",
  // M-Pesa runs against the local simulator (scripts/mpesa-simulate.ts) with its own store.
  CREDENTIALS_ENCRYPTION_KEY: "e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0",
  ALLOW_MPESA_SIMULATOR: "1",
  MPESA_SIM_DIR: ".dev/mpesa-sim-e2e",
};

export default defineConfig({
  testDir: "./e2e",
  // One test at a time: tests share seeded people, and a new sign-in code replaces the old one.
  fullyParallel: false,
  workers: 1,
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
