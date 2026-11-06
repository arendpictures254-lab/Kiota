import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openSection, signIn } from "./helpers";

const samples = path.resolve("docs/samples");

test("Director downloads the template, fixes an import error, imports and finds a student", async ({
  page,
}, testInfo) => {
  // Runs once (mobile first): a parallel sign-in on the same phone would replace the code.
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
  test.setTimeout(90_000);

  await signIn(page, "0711000001", "+254711000001"); // Amina Said, Director of Bahari Academy
  await expect(page.getByRole("heading", { name: "Hello, Amina Said" })).toBeVisible();

  await openSection(page, "Students");
  await page.getByRole("link", { name: "Import from Excel" }).click();

  // 1. Download the template.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download template (.xlsx)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("kiota-import-template-bahari.xlsx");
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip file

  // 2. Upload a filled file with mistakes: the preview lists every problem with a fix.
  await page
    .locator("#import-file")
    .setInputFiles(path.join(samples, "kiota-import-sample-with-errors.xlsx"));
  await page.getByRole("button", { name: "Check the file" }).click();
  await expect(page.getByRole("heading", { name: /problems to fix/ })).toBeVisible();
  await expect(page.getByText('"07123 456" is not a valid phone number.')).toBeVisible();
  await expect(page.getByText('Grade 6 has no stream called "Purple".')).toBeVisible();
  await expect(page.getByText(/used twice in this file/)).toBeVisible();
  await expect(page.getByText(/date of birth is in the future/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+ students$/ })).toHaveCount(0);

  // 3. Upload the corrected file, then import.
  await page
    .locator("#reupload-file")
    .setInputFiles(path.join(samples, "kiota-import-sample.xlsx"));
  await page.getByRole("button", { name: "Check the corrected file" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();
  // A warning, not an error.
  await expect(
    page.getByText("Bakari Ngala (BA/2027/011) has no guardian.").filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 11 students" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible({
    timeout: 30_000,
  });

  // 4. Find an imported student and check their guardian.
  await page.getByRole("link", { name: "See students" }).click();
  await page.getByLabel("Search").fill("Rehema Chiro");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Rehema Chiro/ }).click();
  await expect(page.getByRole("heading", { name: "Rehema Chiro" })).toBeVisible();
  await expect(
    page.getByText("BA/2027/002 · Grade 6 Blue", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("Mwanaisha Chiro").filter({ visible: true })).toBeVisible();
  await expect(page.getByText(/Mother · 0748 000 003/).filter({ visible: true })).toBeVisible();
});
