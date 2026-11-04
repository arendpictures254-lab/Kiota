import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const SITE = "http://localhost:3101";
const APP = "http://app.localhost:3101";

test("the public site's home page", async ({ page }) => {
  await page.goto(`${SITE}/`);
  await expect(page).toHaveTitle("Kiota: every child, one place");
  await expect(
    page.getByRole("heading", { level: 1, name: "Every child, one place." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Book a demo" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat on WhatsApp" }).first()).toHaveAttribute(
    "href",
    "https://wa.me/254720942426",
  );
  for (const heading of [
    "Built for boarding schools",
    "Fees without the paperwork",
    "Report cards that explain themselves",
    "One app for every parent",
    "Safe by design",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Kiota is built by Arend Studio, Nairobi.")).toBeVisible();
  // Social preview image and description.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /opengraph-image/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Kenyan schools/,
  );
});

test("every site page has its own title, and the legal pages are marked as drafts", async ({
  page,
}) => {
  const pages: [string, RegExp][] = [
    ["/features", /^Features · Kiota$/],
    ["/parents", /^For parents · Kiota$/],
    ["/security", /^Security and privacy · Kiota$/],
    ["/demo", /^Book a demo · Kiota$/],
    ["/privacy", /^Privacy policy · Kiota$/],
    ["/terms", /^Terms · Kiota$/],
  ];
  for (const [path, title] of pages) {
    const res = await page.goto(`${SITE}${path}`);
    expect(res?.status(), path).toBe(200);
    await expect(page, path).toHaveTitle(title);
  }
  for (const path of ["/privacy", "/terms"]) {
    await page.goto(`${SITE}${path}`);
    await expect(page.getByText("DRAFT — to be reviewed by a lawyer before launch.")).toBeVisible();
  }
});

test("site and app live on separate addresses", async ({ page }) => {
  await page.goto(`${SITE}/sign-in`);
  await expect(page).toHaveURL(`${APP}/sign-in`);
  await page.goto(`${APP}/features`);
  await expect(page).toHaveURL(`${SITE}/features`);
  const hidden = await page.goto(`${APP}/site/features`);
  expect(hidden?.status()).toBe(404);
  // No sign-up anywhere.
  await page.goto(`${APP}/sign-in`);
  await expect(page.getByText(/there is no sign-up/)).toBeVisible();
  expect(await page.getByRole("link", { name: /sign up|register|create account/i }).count()).toBe(
    0,
  );
  // Node (unlike the browser) cannot resolve app.localhost; the health check answers on any address.
  const health = await page.request.get(`${SITE}/api/health`);
  expect(await health.json()).toEqual({ status: "ok" });
});

test("a school books a demo and an Arend admin sees it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
  const school = `Malindi Hills Academy ${Date.now()}`;
  await page.goto(`${SITE}/demo`);
  await page.getByLabel("School name").fill(school);
  await page.getByLabel("County").fill("Kilifi");
  await page.getByLabel("Your name").fill("Rehema Juma");
  await page.getByLabel("Your role").fill("Director");
  await page.getByLabel("Phone").fill("0712 555 010");
  await page.getByLabel("Number of students").fill("420");
  await page.getByLabel("Type of school").selectOption("mixed");
  await page.getByRole("button", { name: "Request a demo" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();

  await signIn(page, "0700000001", "+254700000001"); // Arend admin
  await page.getByRole("link", { name: "Demo requests" }).click();
  await expect(page.getByText(school)).toBeVisible();
  await expect(page.getByText("Rehema Juma (Director)")).toBeVisible();
});

test("the honeypot silently drops bots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "runs once");
  await page.goto(`${SITE}/demo`);
  await page.getByLabel("School name").fill("Spam Bot School");
  await page.getByLabel("County").fill("Nowhere");
  await page.getByLabel("Your name").fill("Bot");
  await page.getByLabel("Your role").fill("Bot");
  await page.getByLabel("Phone").fill("0712 555 011");
  await page.getByLabel("Number of students").fill("1");
  await page.getByLabel("Type of school").selectOption("day");
  await page.locator("#website").fill("http://spam.example", { force: true });
  await page.getByRole("button", { name: "Request a demo" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
});
