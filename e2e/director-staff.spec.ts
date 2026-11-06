import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_ENV } from "../playwright.config";
import { openSection, signIn } from "./helpers";

test("Director signs in, invites a staff member and grants leave-out approval", async ({
  page,
}, testInfo) => {
  // Runs once (mobile first): a parallel sign-in on the same phone would replace the code.
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
  // Amina Said, Director of Bahari Academy (seed data).
  await signIn(page, "0711 000 001", "+254711000001");

  await expect(page.getByRole("heading", { name: "Hello, Amina Said" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Bahari Academy")).toBeVisible();

  await openSection(page, "Staff");
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
  await page.getByRole("link", { name: "Invite staff" }).click();

  const local = `07${randomInt(10_000_000, 99_999_999)}`;
  const name = `Matron Test ${local.slice(-4)}`;
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Phone number").fill(local);
  await page.getByText("Boarding master", { exact: true }).click();
  await page.getByRole("button", { name: "Invite" }).click();

  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Invited.")).toBeVisible();
  await expect(page.getByText("Cannot approve leave-outs.")).toBeVisible();

  await page.getByRole("button", { name: "Allow to approve leave-outs" }).click();
  await expect(page.getByText("They can now approve leave-outs.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw leave-out approval" })).toBeVisible();

  await openSection(page, "Staff");
  const row = page.getByRole("link", { name: new RegExp(name) });
  await expect(row).toContainText("Can approve leave-outs");

  // Both changes are in the audit log.
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ action: string }>(
    `SELECT a.action FROM audit_logs a
       JOIN memberships m ON m.id::text = a.target_id
       JOIN users u ON u.id = m.user_id
      WHERE u.phone = $1 ORDER BY a.created_at`,
    [`+254${local.slice(1)}`],
  );
  await db.end();
  expect(rows.map((r) => r.action)).toEqual(["staff.invite", "permission.grant"]);
});
