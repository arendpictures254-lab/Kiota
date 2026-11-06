import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_ENV } from "../playwright.config";
import { latestCode, signIn } from "./helpers";

// The parent portal is for phones: these run once, on the phone-sized project.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

const BASE = "http://localhost:3101";

function simulate(script: string, args: string[]) {
  return execFileSync("npx", ["tsx", `scripts/${script}`, ...args, "--base", BASE], {
    env: { ...process.env, ...E2E_ENV },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

test("Wanjiku confirms her Milima child, switches children, pays by M-Pesa and opens the receipt", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Wanjiku Kamau: Brian at Bahari Academy; Joy at Milima School, waiting for her to confirm.
  await signIn(page, "0744000001", "+254744000001");
  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByRole("heading", { name: "All children" })).toBeVisible();

  // Joy is not shown until Wanjiku confirms with a fresh code.
  const nav = page.getByRole("navigation", { name: "Choose a child" });
  await expect(nav.getByRole("link", { name: /Joy/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Milima School wants to add Joy to your account/ }).click();
  await expect(page.getByRole("heading", { name: "Add Joy?" })).toBeVisible();
  const since = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode("+254744000001", since));
  await page.getByRole("button", { name: "Confirm and add Joy" }).click();
  await expect(page.getByText("Joy has been added to your account.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Joy Kamau" })).toBeVisible();
  await expect(page.getByText(/Milima School/).first()).toBeVisible();

  // The switcher now has both children (and "All children").
  await expect(nav.getByRole("link", { name: /Joy/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /All children/ })).toBeVisible();
  await nav.getByRole("link", { name: /Brian/ }).click();
  await expect(page.getByRole("heading", { name: "Brian Kamau" })).toBeVisible();
  await expect(page.getByText(/Bahari Academy/).first()).toBeVisible();

  // Pay: the amount is the balance due, the phone is her own; both can be changed.
  await page.getByRole("link", { name: "Pay with M-Pesa" }).first().click();
  const amount = page.getByLabel("Amount (KES)");
  await expect(amount).not.toHaveValue("");
  await amount.fill("1,250");
  await expect(page.getByLabel("M-Pesa phone number")).toHaveValue("0744 000 001");
  await expect(page.getByText(/Pays Bahari Academy, account BA\/2024\/101/)).toBeVisible();
  await page.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for payment" })).toBeVisible();

  // She enters her PIN (simulated Safaricom); the page notices on its own.
  // Bahari Academy is the only seeded school with M-Pesa, so the simulator picks it.
  const out = simulate("mpesa-simulate.ts", ["stk"]);
  expect(out).toContain("Paid KES 1250");
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: /Open receipt \d{6}/ }).click();
  await expect(page.getByText("KES 1,250").first()).toBeVisible();
  await expect(page.getByText("BA/2024/101").first()).toBeVisible();
});

test("a teacher who is also a parent chooses, and switches between staff and parent", async ({
  page,
}) => {
  // Grace Wanjiru: class teacher at Bahari Academy, and Kibet's mother there.
  await signIn(page, "0711000003", "+254711000003");
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByRole("button", { name: /^Parent/ }).click();
  await expect(page).toHaveURL(/\/parent$/);
  await expect(
    page.getByRole("heading", { name: /Kibet/ }).or(page.getByText(/Kibet/).first()),
  ).toBeVisible();

  await page.getByRole("button", { name: "Staff view" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // Staff pages remember she is working as staff; parent pages are one tap away again.
  await page.goto("/parent");
  await expect(page.getByRole("button", { name: "Staff view" })).toBeVisible();
});

test("the portal in Kiswahili", async ({ page }) => {
  await signIn(page, "0744000001", "+254744000001");
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByText("Kiswahili").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Imehifadhiwa.")).toBeVisible();
  await page.goto("/parent");
  await expect(page.getByRole("heading", { name: "Watoto wote" })).toBeVisible();
  await expect(page.getByText("Jumla ya salio la karo")).toBeVisible();
  // Back to English for the other tests.
  await page.getByRole("link", { name: "Akaunti" }).click();
  await page.getByText("English").click();
  await page.getByRole("button", { name: "Hifadhi" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

test("a number no school has added cannot sign up", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Phone number").fill("0799 123 456");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByText("Your school hasn't added this number yet. Please contact the school."),
  ).toBeVisible();
});

test.describe("a first visit on a slow phone connection", () => {
  // No service worker: it would serve the scripts from its own cache (a returning visit).
  test.use({ serviceWorkers: "block" });

  test("the parent home stays light on a slow 3G connection", async ({ page }) => {
    await signIn(page, "0744000001", "+254744000001");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    // "Slow 3G"-like: 400 ms round trips, about 50 KB/s down.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 400,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
    });
    // A first visit: nothing cached (the worst case on a new phone).
    await cdp.send("Network.clearBrowserCache");
    let bytes = 0;
    cdp.on("Network.loadingFinished", (e) => {
      bytes += e.encodedDataLength;
    });
    const started = Date.now();
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "All children" })).toBeVisible();
    const seconds = (Date.now() - started) / 1000;
    await page.waitForLoadState("networkidle");
    const summary = `parent home on slow 3G: ${seconds.toFixed(1)} s to content, ${(bytes / 1024).toFixed(0)} KB transferred`;
    console.log(summary);
    test.info().annotations.push({
      type: "3G",
      description: `parent home: ${seconds.toFixed(1)} s to content, ${(bytes / 1024).toFixed(0)} KB transferred (empty browser cache)`,
    });
    // Measured at about 1.4 s and 246 KB (mostly the React runtime and two fonts) in Nov 2026.
    expect(seconds).toBeLessThan(5);
    expect(bytes).toBeLessThan(300 * 1024);
  });
});

test("the Director invites one stream's parents after seeing the cost", async ({ page }) => {
  await signIn(page, "0711000001", "+254711000001");
  await page.goto("/dashboard/messages");
  await page.getByRole("link", { name: /Invite parents to Kiota/ }).click();
  await page.getByLabel("Invite").selectOption({ label: "Grade 7 East" });
  await page.getByRole("button", { name: "Check who and the cost" }).click();
  const preview = page.getByRole("region", { name: "Cost before sending" });
  await expect(preview).toContainText("Total cost");
  await expect(preview).toContainText("now uses Kiota");
  const send = page.getByRole("button", { name: /^Send to \d+ parents? · KES/ });
  const recipients = Number(/Send to (\d+)/.exec((await send.textContent()) ?? "")![1]);
  expect(recipients).toBeGreaterThan(0);
  const since = new Date(Date.now() - 1000);
  await send.click();
  await expect(page.getByText(/Inviting \d+ parents?/)).toBeVisible();
  await expect
    .poll(
      async () => {
        const file = await readFile(path.resolve(".dev/sms-outbox.log"), "utf8").catch(() => "");
        return file
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { text: string; at: string })
          .filter(
            (m) =>
              new Date(m.at) >= since &&
              /Bahari Academy (now uses|sasa inatumia) Kiota/.test(m.text),
          ).length;
      },
      { timeout: 20_000 },
    )
    .toBe(recipients);
  await expect(page.getByTestId("signed-in-count")).toContainText(/\d+ of \d+ parents/);
});
