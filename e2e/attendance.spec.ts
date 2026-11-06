import { expect, test } from "@playwright/test";
import { openSection, signIn } from "./helpers";

// Runs once (mobile first: the register is taken on a phone). Sign-in codes are per phone.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

test("a class teacher takes the register in one submit", async ({ page }) => {
  // Grace Wanjiru: class teacher of Grade 7 East (seeded: today's morning register not taken).
  await signIn(page, "0711000003", "+254711000003");
  await page.getByRole("button", { name: /^Staff/ }).click();
  await openSection(page, "Attendance");
  await page.getByRole("link", { name: /Take morning register/ }).click();
  await expect(page.getByRole("heading", { name: "Grade 7 East · Morning" })).toBeVisible();

  // Everyone starts present; one tap = absent, two taps = late.
  const students = page.getByRole("list", { name: "Students" }).getByRole("button");
  const first = students.nth(0);
  const second = students.nth(1);
  await expect(first).toHaveAttribute("data-status", "present");
  await first.click();
  await expect(first).toHaveAttribute("data-status", "absent");
  await second.click();
  await second.click();
  await expect(second).toHaveAttribute("data-status", "late");
  await expect(page.getByTestId("register-counts")).toContainText("1 absent · 1 late");
  // The student on leave is locked.
  const onLeave = page.locator('[data-status="on_leave"]');
  if (await onLeave.count()) await expect(onLeave.first()).toBeDisabled();

  await page.getByRole("button", { name: "Submit register" }).click();
  await expect(page.getByText("Register submitted: 1 absent, 1 late.")).toBeVisible();
  const mine = page.getByRole("listitem").filter({ hasText: "Grade 7 East" });
  await expect(mine.getByRole("link", { name: /✓ Morning/ })).toBeVisible();
});

test("the boarding master checks an absent boarder", async ({ page }) => {
  // Mercy Chebet (seeded: a Grade 8 East boarder marked absent this morning).
  await signIn(page, "0711000005", "+254711000005");
  await page.getByTestId("boarders-to-check").click();
  const alert = page.getByTestId("boarder-alert").first();
  await expect(alert).toContainText("Not checked yet");
  await alert.getByRole("button", { name: "Found", exact: true }).click();
  await expect(page.getByText("Marked as found.")).toBeVisible();
  await expect(alert).toContainText("Found");
});
