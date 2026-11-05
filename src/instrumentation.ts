/**
 * Runs once when the server starts (Next.js instrumentation).
 *  - Production refuses to start with a secret copied from the repository's examples, or with
 *    development messaging settings (console SMS, console
 *    WhatsApp, ALLOW_CONSOLE_SMS) unless KIOTA_DEMO=1 marks a demo server.
 *  - Starts the message sending worker (MESSAGE_WORKER=off to run without it).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { smsConfigProblem } = await import("./lib/sms");
  const { whatsappConfigProblem } = await import("./lib/whatsapp");
  const { secretsProblem } = await import("./lib/secrets-check");
  const problem = secretsProblem() ?? smsConfigProblem() ?? whatsappConfigProblem();
  if (problem) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Kiota will not start: ${problem}. See docs/messaging.md.`);
    }
    console.warn(`[messaging] ${problem}`);
  }

  if (process.env.MESSAGE_WORKER === "off") return;
  const [{ startMessageWorker }, { platformDb }] = await Promise.all([
    import("./lib/messaging/worker-loop"),
    import("./lib/db"),
  ]);
  startMessageWorker(platformDb);
}
