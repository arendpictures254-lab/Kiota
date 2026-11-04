import { expect, test } from "@playwright/test";

test("home page shows the Kiota name and tagline", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Kiota");
  await expect(page.getByRole("heading", { level: 1, name: "Kiota" })).toBeVisible();
  await expect(page.getByText("Every child, one place.")).toBeVisible();
});
