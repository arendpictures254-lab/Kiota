import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Each test signs in a different seeded phone. Run once (mobile first) so parallel
// projects never replace each other's sign-in codes.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

test("someone at two schools picks which one to open", async ({ page }) => {
  await signIn(page, "0733000001", "+254733000001"); // Faith Njeri
  await expect(page.getByRole("heading", { name: "Choose a school" })).toBeVisible();
  await page.getByRole("button", { name: /Milima School/ }).click();
  await expect(page.getByRole("heading", { name: "Hello, Faith Njeri" })).toBeVisible();
  await expect(page.getByText("Milima School").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Subject teacher").filter({ visible: true })).toBeVisible();

  await page.getByRole("link", { name: "Switch school" }).click();
  await page.getByRole("button", { name: /Bahari Academy/ }).click();
  await expect(page.getByRole("heading", { name: "Hello, Faith Njeri" })).toBeVisible();
  await expect(page.getByText("Bahari Academy").filter({ visible: true })).toBeVisible();
});

test("a Bursar has no staff tools, and the staff pages refuse them on the server", async ({
  page,
}) => {
  await signIn(page, "0722000002", "+254722000002"); // Mary Achieng, Milima bursar
  await expect(page.getByRole("heading", { name: "Hello, Mary Achieng" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff" })).toHaveCount(0);

  await page.goto("/dashboard/staff/invite");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("an Arend admin creates a school and its Director", async ({ page }) => {
  await signIn(page, "0700000001", "+254700000001");
  await expect(page.getByRole("heading", { name: "Schools" })).toBeVisible();
  await page.getByRole("link", { name: "Create a school" }).click();

  const suffix = randomInt(1000, 9999);
  await page.getByLabel("School name").fill(`Pwani Girls ${suffix}`);
  await page.getByLabel("Short name").fill("PWANI");
  await page.getByLabel("County").fill("Mombasa");
  await page.getByText("Junior School (Grade 7–Grade 9)").click();
  await page.getByLabel("Director's full name").fill("Halima Omar");
  await page.getByLabel("Director's phone number").fill(`07${randomInt(10_000_000, 99_999_999)}`);
  await page.getByRole("button", { name: "Create school" }).click();

  await expect(page.getByText("School created.")).toBeVisible();
  await expect(page.getByText(`Pwani Girls ${suffix}`)).toBeVisible();
});

test("unknown numbers are told to ask their school", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Phone number").fill("0799999999");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByText("Your school hasn't added this number yet. Please contact the school."),
  ).toBeVisible();
});
