import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_ENV } from "../playwright.config";
import { fromUserMenu, openSection, signIn } from "./helpers";

// Runs once, on the phone (the storekeeper works from a phone or tablet in the store).
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "runs once, on mobile");
});

async function sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Earlier runs ate into the seeded stock: deliver a fresh 100 units of every lunch item. */
async function topUpLunch() {
  await sql(
    `INSERT INTO stock_movements (school_id, store_id, item_id, kind, quantity_milli, value_cents, occurred_on, created_by_id, delivery_note)
     SELECT i.school_id, i.store_id, i.id, 'receive', 100000, 500000, CURRENT_DATE, u.id, 'E2E top-up'
     FROM ration_lines r JOIN meals m ON m.id = r.meal_id AND m.name = 'Lunch'
     JOIN store_items i ON i.id = r.item_id
     JOIN schools sc ON sc.id = i.school_id AND sc.name = 'Bahari Academy'
     JOIN users u ON u.phone = '+254711000011'`,
  );
}

test("the storekeeper issues for lunch and sees a variance flag", async ({ page }) => {
  await topUpLunch();
  await signIn(page, "0711000011", "+254711000011"); // Omar Hassan, Storekeeper
  await openSection(page, "Stores");
  await page.getByRole("link", { name: "Issue for a meal" }).click();
  await page
    .getByRole("navigation", { name: "Meals" })
    .getByRole("link", { name: /^Lunch/ })
    .click();
  await expect(page.getByLabel("Students served")).not.toHaveValue("");
  // Kiota suggests from the ration scale; the storekeeper issues half as much maize again.
  const maize = page.getByTestId("meal-line").filter({ hasText: "Maize flour" });
  const box = maize.getByLabel(/Issued/);
  const suggested = Number(await box.inputValue());
  expect(suggested).toBeGreaterThan(0);
  await box.fill(String(Math.round(suggested * 1.5 * 1000) / 1000));
  await expect(maize).toContainText("the Director will see this");
  await page.getByRole("button", { name: "Record issue" }).click();
  await expect(page.getByText(/flagged to the Director/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Lunch/ })).toBeVisible();
});

test("a uniform issue appears on the fee statement and in the parent portal", async ({ page }) => {
  await signIn(page, "0711000011", "+254711000011");
  await page.goto("/dashboard/stores/uniforms");
  await page.getByLabel("Student's admission number").fill("BA/2024/101"); // Brian Kamau
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("heading", { name: "Brian Kamau" })).toBeVisible();
  // He already has shirts and a sweater: the screen shows them.
  await expect(page.getByTestId("uniform-history")).toContainText("Shirt (14)");
  const socks = await page
    .getByLabel("Item")
    .locator("option", { hasText: "Socks (pair)" })
    .first()
    .getAttribute("value");
  await page.getByLabel("Item", { exact: true }).selectOption(socks!);
  await page.getByLabel("How many").fill("2");
  // Socks may have been issued by an earlier run: say it is meant.
  await page.getByLabel(/Issue again/).check();
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(page.getByText("Issued.")).toBeVisible();

  // The fee statement is the ledger: one charge on the Uniform vote head.
  const charges = await sql<{ description: string; amount_cents: number }>(
    `SELECT e.description, e.amount_cents FROM ledger_entries e JOIN students s ON s.id = e.student_id
     WHERE s.admission_number = 'BA/2024/101' AND e.type = 'charge' AND e.description = 'Uniform: Socks (pair) x2'`,
  );
  expect(charges.length).toBeGreaterThan(0);
  expect(charges[0].amount_cents).toBe(50_000);

  // And the parent sees it under Other charges.
  await fromUserMenu(page, page.getByRole("button", { name: "Sign out" }));
  await signIn(page, "0744000001", "+254744000001"); // Wanjiku Kamau
  await page.goto("/parent");
  await page.getByRole("link", { name: /Brian/ }).first().click();
  await page.getByRole("link", { name: "Fees" }).first().click();
  await expect(page.getByTestId("other-charges")).toContainText("Uniform: Socks (pair) x2");
  await expect(page.getByTestId("other-charges")).toContainText("KES 500");
});

test("a stock-take is counted, approved and posted", async ({ page }) => {
  await signIn(page, "0711000011", "+254711000011");
  await page.goto("/dashboard/stores/stocktakes");
  await page.getByLabel("Store").selectOption({ label: "Uniform store" });
  await page.getByRole("button", { name: "Start a stock-take" }).click();
  await expect(page.getByRole("heading", { name: "Stock-take · Uniform store" })).toBeVisible();
  // Count every item on the phone: 10 of each.
  const boxes = page.getByRole("textbox", { name: /: count$/ });
  const n = await boxes.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) await boxes.nth(i).fill("10");
  await expect(page.getByText(`${n} of ${n} counted`)).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText(/against the records, worth/)).toBeVisible();
  const url = page.url();

  // The Director approves: only now do the adjustments post.
  await fromUserMenu(page, page.getByRole("button", { name: "Sign out" }));
  await signIn(page, "0711000001", "+254711000001");
  await page.goto(url);
  await page.getByRole("button", { name: "Approve and post the differences" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Approved: \d+ adjustments? posted/ }),
  ).toBeVisible();
  const id = url.split("/").pop()!;
  const [{ status }] = await sql<{ status: string }>(
    "SELECT status FROM stocktakes WHERE id = $1",
    [id],
  );
  expect(status).toBe("approved");
  const stock = await sql<{ qty: string }>(
    `SELECT DISTINCT sum(m.quantity_milli) OVER (PARTITION BY m.item_id) AS qty
     FROM stock_movements m JOIN store_items i ON i.id = m.item_id JOIN stores s ON s.id = i.store_id
     WHERE s.name = 'Uniform store' AND i.active AND s.school_id = (SELECT id FROM schools WHERE name = 'Bahari Academy')`,
  );
  expect(stock.map((s) => Number(s.qty))).toEqual([10_000]);
});
