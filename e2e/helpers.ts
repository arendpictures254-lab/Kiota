import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

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
}
