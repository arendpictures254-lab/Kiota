import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Page, devices, expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// On a phone screen, once.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

type Sms = { to: string; text: string; at: string };

async function smsTo(phone: string, since: Date, match: RegExp): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const file = await readFile(path.resolve(".dev/sms-outbox.log"), "utf8").catch(() => "");
        found = file
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Sms)
          .filter((m) => m.to === phone && new Date(m.at) >= since && match.test(m.text))
          .at(-1)?.text;
        return found;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  return found!;
}

/** "2026-11-13T14:00" (Nairobi time) for a moment `minutes` from now. */
const nairobiIn = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000 + 3 * 3600_000).toISOString().slice(0, 16);

/** Another person's phone: a fresh browser context, phone-sized. */
async function newPhone(page: Page) {
  // A browser context takes the device settings except which browser to use.
  const pixel: Record<string, unknown> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType;
  const ctx = await page
    .context()
    .browser()!
    .newContext({
      ...pixel,
      baseURL: test.info().project.use.baseURL,
    });
  return ctx.newPage();
}

test("a parent requests, the boarding master approves, the guard scans the printed pass, out and back with SMS", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const WANJIKU = "+254744000001";
  const tag = `E2E ${Date.now()}`;
  const started = new Date(Date.now() - 1000);

  // 1. Wanjiku asks, from the parent portal, to collect Brian in half an hour.
  await signIn(page, "0744000001", WANJIKU);
  const nav = page.getByRole("navigation", { name: "Choose a child" });
  await nav.getByRole("link", { name: /Brian/ }).click();
  await page.getByRole("link", { name: "Leave-outs" }).click();
  await page.getByRole("link", { name: "Request a leave-out" }).click();
  await page.getByLabel("Reason").selectOption({ label: "Medical appointment" });
  await page.getByLabel("Details (optional)").fill(tag);
  await page.getByLabel("Leaves").fill(nairobiIn(30));
  await page.getByLabel("Back by").fill(nairobiIn(48 * 60));
  await page.getByRole("button", { name: "Send to the school" }).click();
  await expect(page.getByText(/Sent\. The school will approve or decline it/)).toBeVisible();

  // 2. Mercy, the boarding master the Director allowed to approve, approves it on her phone.
  const mercy = await newPhone(page);
  await signIn(mercy, "0711000005", "+254711000005");
  await mercy.goto("/dashboard/leaveouts");
  await mercy
    .getByRole("link")
    .filter({ hasText: "Brian Kamau" })
    .filter({ hasText: "Medical appointment" })
    .first()
    .click();
  await expect(mercy.getByText(tag)).toBeVisible();
  await mercy.getByRole("button", { name: "Approve" }).click();
  await expect(mercy.getByText(/Approved\. The collector has their pickup code/)).toBeVisible();

  // The collector (Wanjiku) gets the 4-digit pickup code by SMS.
  const codeSms = await smsTo(WANJIKU, started, /pickup code for Brian is \d{4}/);
  const code = /is (\d{4})/.exec(codeSms)![1];

  // 3. The printed pass: its QR code, photographed (our image fixture).
  await mercy.getByRole("link", { name: "Print the gate pass" }).click();
  await expect(mercy.getByText("Leave-out pass")).toBeVisible();
  const qrImage = testInfo.outputPath("pass-qr.png");
  await mercy.getByTestId("pass-qr").screenshot({ path: qrImage });

  // 4. Hassan, the gate guard, scans it, takes the pickup code and lets Brian out.
  const gate = await newPhone(page);
  await signIn(gate, "0711000004", "+254711000004");
  await expect(gate).toHaveURL(/\/gate$/);
  // The gate has downloaded its passes (and is ready) before the first scan.
  await expect(gate.getByTestId("gate-status")).toContainText(/\d+ passes/);
  await gate.getByLabel("Photo of the pass").setInputFiles(qrImage);
  await expect(gate.getByTestId("verdict")).toContainText("VALID");
  await expect(gate.getByTestId("verdict")).toContainText("Leaving");
  await expect(gate.getByText("Brian Kamau")).toBeVisible();
  await expect(gate.getByText("Wanjiku Kamau (mother)")).toBeVisible();
  // A wrong code is refused.
  await gate.getByLabel("Collector's pickup code").fill(code === "1111" ? "2222" : "1111");
  await gate.getByRole("button", { name: "Mark exit" }).click();
  await expect(gate.getByText(/Wrong pickup code/)).toBeVisible();
  await gate.getByLabel("Collector's pickup code").fill(code);
  await gate.getByRole("button", { name: "Mark exit" }).click();
  await expect(gate.getByText(/Exit recorded at \d{2}:\d{2}/)).toBeVisible();

  const exitSms = await smsTo(
    WANJIKU,
    started,
    /^Brian left Bahari Academy at \d{2}:\d{2} with Wanjiku Kamau\.$/,
  );
  expect(exitSms).toMatch(/^Brian left Bahari Academy at \d{2}:\d{2} with Wanjiku Kamau\.$/);

  // 5. Back: the same pass again offers the return.
  await gate.getByLabel("Photo of the pass").setInputFiles(qrImage);
  await expect(gate.getByTestId("verdict")).toContainText("Coming back");
  await gate.getByRole("button", { name: "Mark return" }).click();
  await expect(gate.getByText(/Return recorded at \d{2}:\d{2}/)).toBeVisible();
  const backSms = await smsTo(WANJIKU, started, /^Brian is back at school, \d{2}:\d{2}\.$/);
  expect(backSms).toMatch(/is back at school/);

  // 6. Used: a third scan is NOT VALID.
  await gate.getByLabel("Photo of the pass").setInputFiles(qrImage);
  await expect(gate.getByTestId("verdict")).toContainText("NOT VALID");
  await expect(gate.getByTestId("verdict")).toContainText("Already used");

  // The parent sees it back; the Director's board no longer lists Brian as out.
  await page.reload();
  await expect(
    page.getByTestId("parent-leaveout").filter({ hasText: "Medical appointment" }).first(),
  ).toContainText("Back at school");
});

test("the gate guard sees only the gate", async ({ page }) => {
  await signIn(page, "0711000004", "+254711000004");
  await expect(page).toHaveURL(/\/gate$/);
  for (const path of ["/dashboard/students", "/dashboard/fees", "/dashboard/leaveouts"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/gate$/);
  }
});

test("the gate works offline: the exit is kept on the phone and sent when it is back online", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const JANE = "+254745000016"; // BA/2025/016's mother, authorised to collect
  const tag = `E2E offline ${Date.now()}`;
  const started = new Date(Date.now() - 1000);

  // The boarding master requests and approves it (staff side).
  await signIn(page, "0711000005", "+254711000005");
  await page.goto("/dashboard/leaveouts/new?student=BA/2025/016");
  await page.getByLabel("Reason").selectOption({ label: "Weekend" });
  await page.getByLabel("Details (optional)").fill(tag);
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent for approval.")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Approved\. The collector has their pickup code/)).toBeVisible();
  const code = /is (\d{4})/.exec(await smsTo(JANE, started, /pickup code for \w+ is \d{4}/))![1];
  await page.getByRole("link", { name: "Print the gate pass" }).click();
  const qrImage = testInfo.outputPath("offline-pass-qr.png");
  await page.getByTestId("pass-qr").screenshot({ path: qrImage });

  // The gate phone has today's passes, then loses its connection.
  const gate = await newPhone(page);
  await signIn(gate, "0711000004", "+254711000004");
  await expect(gate.getByTestId("gate-status")).toContainText(/\d+ passes/);
  await gate.context().setOffline(true);
  await expect(gate.getByTestId("gate-status")).toContainText("Offline");
  await gate.getByLabel("Photo of the pass").setInputFiles(qrImage);
  await expect(gate.getByTestId("verdict")).toContainText("VALID");
  await gate.getByLabel("Collector's pickup code").fill(code);
  await gate.getByRole("button", { name: "Mark exit" }).click();
  await expect(gate.getByText(/It will be sent when the phone is online/)).toBeVisible();
  await expect(gate.getByTestId("gate-status")).toContainText("1 to send");

  // Back online: it is sent, recorded once, and the parent gets the SMS.
  await gate.context().setOffline(false);
  await expect(gate.getByTestId("gate-status")).not.toContainText("to send", { timeout: 30_000 });
  await smsTo(JANE, started, /left Bahari Academy at \d{2}:\d{2} with Jane Otieno\.$/);
});
