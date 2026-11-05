/**
 * Production must never run on a secret that is written down in this repository (the examples
 * in .env.example, the test and end-to-end configs). Checked at start-up (src/instrumentation.ts);
 * a demo server (KIOTA_DEMO=1, also used by the end-to-end tests) is allowed to.
 */
type Env = Record<string, string | undefined>;

/** Values committed to the repository, which are therefore public. */
const PUBLIC_VALUES = [
  "df971de4e323c0740729647e79146401fbb1bc01e5a9cd7580fe617b4f93cc6a", // .env.example
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // vitest.config.mts
  "e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0", // playwright.config.ts
  "dev-only-change-me-to-a-long-random-string",
  "test-secret",
  "e2e-secret",
];

const SECRETS = [
  "AUTH_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY",
  "SMS_CALLBACK_TOKEN",
  "PLATFORM_MPESA_CALLBACK_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
];

export function secretsProblem(env: Env = process.env): string | null {
  if (env.NODE_ENV !== "production" || env.KIOTA_DEMO === "1") return null;
  for (const name of SECRETS) {
    const v = env[name];
    if (!v) continue;
    if (PUBLIC_VALUES.includes(v) || /change-me|dev-|example/i.test(v)) {
      return `${name} is an example value from the repository: generate a real one (openssl rand -hex 32)`;
    }
  }
  return null;
}
