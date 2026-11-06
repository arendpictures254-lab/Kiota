import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Read the newest sign-in code sent to `phone` (E.164) by the console SMS driver. */
export async function latestCode(phone: string, since: Date): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const file = await readFile(path.resolve(".dev/sms-outbox.log"), "utf8").catch(() => "");
        const messages = file
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { to: string; text: string; at: string })
          .filter((m) => m.to === phone && new Date(m.at) >= since && /code is \d{6}/.test(m.text));
        code = messages.at(-1)?.text.match(/code is (\d{6})/)?.[1];
        return code;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  return code!;
}

export async function signIn(page: Page, localPhone: string, e164: string) {
  const since = new Date(Date.now() - 1000);
  await page.goto("/sign-in");
  await page.getByLabel("Phone number").fill(localPhone);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page.getByLabel("6-digit code").fill(await latestCode(e164, since));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

/**
 * Open a main section the way a person would: from the sidebar on a laptop, or the bottom tab
 * bar on a phone (opening "More" when the section is tucked away there).
 */
export async function openSection(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Sections" }).filter({ visible: true });
  const link = nav.getByRole("link", { name, exact: true });
  const more = nav.getByText("More", { exact: true });
  // The navigation streams in after the page: wait for it.
  await expect(link.or(more).first()).toBeVisible();
  if (!(await link.isVisible())) await more.click();
  await link.click();
}

/** Click something in the user menu (Sign out, Switch school...), opening the menu if needed. */
export async function fromUserMenu(page: Page, target: Locator) {
  if (!(await target.isVisible()))
    await page.getByTestId("user-menu").filter({ visible: true }).first().click();
  await target.click();
}
