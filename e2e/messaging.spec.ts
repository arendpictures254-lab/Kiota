import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ENV } from "../playwright.config";
import { signIn } from "./helpers";

// Runs once (mobile first). Peter Otieno is Bahari Academy's Bursar; Amina Said its Director.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

const BASE = "http://localhost:3101";

type Sms = { id?: string; to: string; text: string; at: string };

async function smsSince(since: Date): Promise<Sms[]> {
  const file = await readFile(path.resolve(".dev/sms-outbox.log"), "utf8").catch(() => "");
  return file
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Sms)
    .filter((m) => new Date(m.at) >= since);
}

function simulate(script: string, args: string[]) {
  return execFileSync("npx", ["tsx", `scripts/${script}`, ...args, "--base", BASE], {
    env: { ...process.env, ...E2E_ENV },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

test("a payment sends the guardian an SMS with the receipt link", async ({ page }) => {
  await signIn(page, "0711000002", "+254711000002");
  const since = new Date(Date.now() - 1000);
  await page.goto("/dashboard/fees/pay");
  await page.getByLabel("Admission number").fill("BA/2025/003");
  await page.getByLabel("Amount (KES)").fill("2,500");
  await page.getByLabel("How was it paid?").selectOption("cash");
  await page.getByLabel("Paid by", { exact: true }).fill("Parent");
  await page.getByRole("button", { name: "Save and issue receipt" }).click();
  const saved = page.getByText(/Payment saved\. Receipt No\. \d{6} issued\./);
  await expect(saved).toBeVisible();
  const receiptNo = /Receipt No\. (\d{6})/.exec((await saved.textContent()) ?? "")![1];

  // The worker sends it in the background: the screen never waited for it.
  let sms: Sms | undefined;
  await expect
    .poll(
      async () => {
        sms = (await smsSince(since)).find((m) => m.text.includes(`Receipt ${receiptNo}:`));
        return sms?.text;
      },
      { timeout: 20_000 },
    )
    .toContain("KES 2,500 received for");
  expect(sms!.text).toContain("BA/2025/003");
  expect(sms!.text).toMatch(/New balance KES [\d,]+/);

  // The link in the SMS opens the receipt; a made-up link is a real 404.
  const token = /\/r\/([A-Za-z0-9_-]+)/.exec(sms!.text)![1];
  await page.goto(`/r/${token}`);
  await expect(page.getByText("KES 2,500").first()).toBeVisible();
  const missing = await page.goto("/r/not-a-real-receipt-link-at-all");
  expect(missing?.status()).toBe(404);

  // Africa's Talking reports it delivered (simulated); the message history shows it.
  simulate("sms-simulate.ts", ["deliver", "--to", sms!.to]);
  await page.goto("/dashboard/messages/log?status=delivered");
  const row = page.getByRole("listitem").filter({ hasText: `Receipt ${receiptNo}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Delivered");
});

test("the Director tops up the wallet by M-Pesa (simulated STK Push)", async ({ page }) => {
  await signIn(page, "0711000001", "+254711000001");
  await page.goto("/dashboard/messages/wallet");
  await expect(page.getByTestId("wallet-balance")).toBeVisible();
  // A different amount each run: the e2e database keeps earlier runs.
  const amount = 700 + (Date.now() % 250);
  await page.getByLabel("Amount (KES)").fill(String(amount));
  await page.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(page.getByText(/Prompt sent to/)).toBeVisible();

  const out = simulate("mpesa-simulate.ts", ["topup"]);
  expect(out).toContain(`Paid KES ${amount}`);
  expect(out).toContain('"ResultCode":"0"');

  // Confirmed with (simulated) Safaricom, then credited once.
  await page.reload();
  const added = page
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`KES ${amount}(\\.00)? · M-Pesa`) });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText("Added");
  await expect(added).toContainText(/SL[A-Z0-9]{8}/);
});

test("the Director sends a notice to one stream after seeing the cost", async ({ page }) => {
  await signIn(page, "0711000001", "+254711000001");
  await page.goto("/dashboard/messages");
  await page.getByRole("link", { name: "Send a notice" }).click();

  await page.getByLabel("Send to").selectOption({ label: "Grade 7 East" });
  const text = `Grade 7 East: sports day is on Friday ${Date.now() % 10_000}. Send a packed lunch.`;
  await page.getByLabel("Message", { exact: true }).fill(text);
  await expect(page.locator("#message-count")).toContainText("1 SMS");
  await page.getByRole("button", { name: "Check cost" }).click();

  const preview = page.getByRole("region", { name: "Cost before sending" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Total cost");
  await expect(preview).toContainText("Balance after");
  const send = page.getByRole("button", { name: /^Send to \d+ parents? · KES/ });
  const recipients = Number(/Send to (\d+)/.exec((await send.textContent()) ?? "")![1]);
  expect(recipients).toBeGreaterThan(0);

  const since = new Date(Date.now() - 1000);
  await send.click();
  await expect(page.getByText(/Sending to \d+ parents?/)).toBeVisible();

  // One SMS per parent of the stream, each in the school's name.
  await expect
    .poll(async () => (await smsSince(since)).filter((m) => m.text.includes(text)).length, {
      timeout: 20_000,
    })
    .toBe(recipients);
  const sent = (await smsSince(since)).filter((m) => m.text.includes(text));
  expect(sent.every((m) => m.text.startsWith("Bahari Academy"))).toBe(true);
});
