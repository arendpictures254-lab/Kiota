import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ENV } from "../playwright.config";
import { openSection, signIn } from "./helpers";

// Runs once (mobile first). Peter Otieno is Bahari Academy's Bursar; Amina Said its Director.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

async function contentType(page: Page, path: string) {
  return page.evaluate(async (p) => (await fetch(p)).headers.get("content-type"), path);
}

test("Bursar records cash, prints a thermal receipt and reverses it with a reason", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await signIn(page, "0711000002", "+254711000002");
  await openSection(page, "Fees");
  await page.getByRole("link", { name: "Record a payment" }).click();

  await page.getByLabel("Admission number").fill("BA/2025/002");
  await page.getByLabel("Amount (KES)").fill("1,234");
  await page.getByLabel("How was it paid?").selectOption("cash");
  await page.getByLabel("Paid by", { exact: true }).fill("Grace Mwangi");
  await page.getByRole("button", { name: "Save and issue receipt" }).click();

  await expect(page.getByText(/Payment saved\. Receipt No\. \d{6} issued\./)).toBeVisible();
  const sheet = page.locator('article[data-layout="thermal"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Bahari Academy"); // shown in capitals by CSS
  await expect(sheet).toContainText("KES 1,234");
  await expect(sheet).toContainText("Grace Mwangi");
  await expect(sheet).toContainText("Powered by");

  await page.getByRole("button", { name: "Print thermal receipt" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  const receiptPath = new URL(page.url()).pathname;
  const receiptId = receiptPath.split("/").pop();
  expect(await contentType(page, `/files/receipts/${receiptId}?layout=thermal`)).toBe(
    "application/pdf",
  );
  expect(await contentType(page, `/files/receipts/${receiptId}?layout=a4`)).toBe("application/pdf");

  await page.getByLabel("Reason").fill("Wrong student: the money was for her brother");
  await page.getByRole("button", { name: "Reverse this payment" }).click();
  await expect(
    page.getByText(/Reversed by Peter Otieno on .*The Director was notified/),
  ).toBeVisible();
  await expect(sheet).toContainText("REVERSED");
  await expect(sheet).toContainText("Wrong student: the money was for her brother");
  await expect(page.getByRole("button", { name: "Reverse this payment" })).toHaveCount(0);
});

test("a simulated M-Pesa payment appears with its receipt", async ({ page }) => {
  const out = execFileSync(
    "npx",
    [
      "tsx",
      "scripts/mpesa-simulate.ts",
      "c2b",
      "--account",
      "ba2025005",
      "--amount",
      "777",
      "--base",
      "http://localhost:3101",
    ],
    { env: { ...process.env, ...E2E_ENV }, encoding: "utf8", shell: process.platform === "win32" },
  );
  const transId = /Paybill payment (SL[A-Z0-9]{8})/.exec(out)?.[1];
  expect(transId, out).toBeTruthy();
  expect(out).toContain('"ResultCode":"0"');

  await signIn(page, "0711000002", "+254711000002");
  await page.goto(`/dashboard/fees/payments?q=${transId}`);
  const row = page.getByRole("link", { name: /KES 777/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`M-Pesa ${transId}`);
  await row.click();
  const sheet = page.locator('article[data-layout="thermal"]');
  await expect(sheet).toContainText("KES 777");
  await expect(sheet).toContainText(transId!);
  await expect(sheet).toContainText("BA/2025/005");

  // The same callback again never creates a second payment.
  execFileSync(
    "npx",
    [
      "tsx",
      "scripts/mpesa-simulate.ts",
      "repeat",
      "--trans",
      transId!,
      "--base",
      "http://localhost:3101",
    ],
    {
      env: { ...process.env, ...E2E_ENV },
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  await page.goto(`/dashboard/fees/payments?q=${transId}`);
  await expect(page.getByRole("link", { name: /KES 777/ })).toHaveCount(1);
});

test("the Director sees collected vs expected, and is told about reversals", async ({ page }) => {
  await signIn(page, "0711000001", "+254711000001");
  await expect(page.getByText(/reversed/i).first()).toBeVisible(); // notification from the seed
  await openSection(page, "Fees");
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(
    page.getByRole("heading", { name: "Collected vs expected · Term 1 2027" }),
  ).toBeVisible();
  await expect(page.getByText(/of KES [\d,]+ expected/)).toBeVisible();
  // A table on a laptop, stacked rows on a phone.
  await expect(
    page.getByText("Tuition", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Grade 7", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: /Export everything to Excel/ })
    .getAttribute("href");
  expect(await contentType(page, href!)).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});
