/**
 * Pretend to be Africa's Talking: send delivery reports for the SMS the console driver "sent"
 * (.dev/sms-outbox.log) to a running Kiota, exactly as AT posts them (form-encoded).
 * Needs SMS_CALLBACK_TOKEN in .env, the same value the app uses.
 *
 *   npm run sms:simulate                                   (= deliver: every SMS not yet reported)
 *   npm run sms:simulate -- deliver --to 0712345678        (only SMS to this phone)
 *   npm run sms:simulate -- fail                           (the newest SMS failed)
 *   npm run sms:simulate -- fail --to 0712345678 --reason AbsentSubscriber
 *   npm run sms:simulate -- fail --id console-...          (one SMS by its id)
 *   npm run sms:simulate -- list                           (the newest SMS and whether reported)
 *   npm run sms:simulate -- reply --from 0744000001 --text "YES 1234"
 *                                     (a parent answers a leave-out collector request by SMS)
 *
 * Options: --base http://localhost:3000 (the app's address, default SIMULATOR_BASE_URL or
 * http://localhost:3000), --outbox .dev/sms-outbox.log. Reports for sign-in codes (which are not
 * school messages) are answered "OK" and change nothing, as with real AT.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizePhone } from "../src/lib/phone";

type Sent = { id?: string; to: string; from?: string | null; text: string; at: string };

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const outbox = path.resolve(arg("outbox", ".dev/sms-outbox.log")!);
const reportedFile = path.join(path.dirname(outbox), "sms-sim-reported.json");

function readOutbox(): (Sent & { id: string })[] {
  let text = "";
  try {
    text = readFileSync(outbox, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Sent)
    .filter((m): m is Sent & { id: string } => !!m.id); // lines from before ids existed
}

function readReported(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(reportedFile, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function report(base: string, token: string, m: Sent & { id: string }, failReason?: string) {
  const body = new URLSearchParams({
    id: m.id,
    status: failReason ? "Failed" : "Success",
    phoneNumber: m.to,
    networkCode: "63902",
    ...(failReason ? { failureReason: failReason } : {}),
    retryCount: "0",
  });
  const res = await fetch(`${base}/api/hooks/sms/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  console.log(
    `  ${failReason ? "FAILED   " : "delivered"} ${m.to}  ${m.text.slice(0, 50).replace(/\n/g, " ")}... -> ${res.status} ${text}`,
  );
  if (!res.ok) throw new Error(`Kiota answered ${res.status}`);
}

async function main() {
  const command = process.argv[2]?.startsWith("--") ? "deliver" : (process.argv[2] ?? "deliver");
  const base = (
    arg("base", process.env.SIMULATOR_BASE_URL ?? "http://localhost:3000") ?? ""
  ).replace(/\/$/, "");
  const all = readOutbox();
  const reported = readReported();
  const to = arg("to") ? normalizePhone(arg("to")!) : null;
  if (arg("to") && !to) throw new Error(`"${arg("to")}" is not a phone number`);
  const id = arg("id");
  const chosen = all.filter((m) => (!to || m.to === to) && (!id || m.id === id));

  if (command === "list") {
    for (const m of chosen.slice(-20)) {
      console.log(
        `${m.at}  ${m.id}  ${m.to}  ${reported[m.id] ?? "not reported"}  ${m.text.slice(0, 40).replace(/\n/g, " ")}`,
      );
    }
    if (chosen.length === 0) console.log(`No SMS in ${outbox} yet.`);
    return;
  }

  const token = process.env.SMS_CALLBACK_TOKEN;
  if (!token || token.length < 20)
    throw new Error("Set SMS_CALLBACK_TOKEN in .env (20+ characters; see .env.example)");

  if (command === "deliver") {
    const todo = chosen.filter((m) => !reported[m.id]);
    if (todo.length === 0)
      return console.log("Nothing to report: every SMS has a delivery report.");
    console.log(`Delivery reports for ${todo.length} SMS to ${base}`);
    for (const m of todo) {
      await report(base, token, m);
      reported[m.id] = "delivered";
      writeFileSync(reportedFile, JSON.stringify(reported, null, 2));
    }
    return;
  }

  if (command === "reply") {
    const from = normalizePhone(arg("from") ?? "");
    const text = arg("text");
    if (!from || !text) throw new Error('Use --from 0744000001 --text "YES 1234"');
    const res = await fetch(`${base}/api/hooks/sms-in/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        from,
        to: "KIOTA",
        text,
        date: new Date().toISOString(),
        id: `sim-${Date.now()}`,
      }),
    });
    console.log(`Reply from ${from}: "${text}" -> ${res.status} ${await res.text()}`);
    return;
  }

  if (command === "fail") {
    const m = chosen.at(-1);
    if (!m) throw new Error("No SMS found. Send one from Kiota first.");
    await report(base, token, m, arg("reason", "AbsentSubscriber"));
    reported[m.id] = "failed";
    writeFileSync(reportedFile, JSON.stringify(reported, null, 2));
    return;
  }

  console.log("Commands: deliver, fail, reply, list. See the top of scripts/sms-simulate.ts.");
  process.exit(2);
}

main().catch((err) => {
  console.error(String((err as Error).message ?? err));
  process.exit(1);
});
