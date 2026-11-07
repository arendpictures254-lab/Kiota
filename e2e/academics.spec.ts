import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_ENV } from "../playwright.config";
import { fromUserMenu, signIn } from "./helpers";

async function sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

type Ids = { term: string; g7West: string; g8East: string; english: string; science: string };
async function ids(): Promise<Ids> {
  const [r] = await sql<Ids>(`
    SELECT
      (SELECT t.id FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
        WHERE t.school_id = sc.id AND t.name = 'Term 3' AND y.name = '2026') AS term,
      (SELECT st.id FROM streams st JOIN classes c ON c.id = st.class_id
        WHERE st.school_id = sc.id AND c.name = 'Grade 7' AND st.name = 'West') AS "g7West",
      (SELECT st.id FROM streams st JOIN classes c ON c.id = st.class_id
        WHERE st.school_id = sc.id AND c.name = 'Grade 8' AND st.name = 'East') AS "g8East",
      (SELECT s.id FROM subjects s JOIN levels l ON l.id = s.level_id
        WHERE s.school_id = sc.id AND l.key = 'junior' AND s.name = 'English') AS english,
      (SELECT s.id FROM subjects s JOIN levels l ON l.id = s.level_id
        WHERE s.school_id = sc.id AND l.key = 'junior' AND s.name = 'Integrated Science') AS science
    FROM schools sc WHERE sc.name = 'Bahari Academy'`);
  return r;
}

const marksFor = (stream: string, subject: string, assessment: string) =>
  sql<{ name: string; status: string; score_tenths: number | null }>(
    `SELECT s.first_name || ' ' || s.last_name AS name, m.status, m.score_tenths
     FROM marks m JOIN students s ON s.id = m.student_id JOIN assessments a ON a.id = m.assessment_id
     WHERE m.stream_id = $1 AND m.subject_id = $2 AND a.name = $3 ORDER BY s.admission_number`,
    [stream, subject, assessment],
  );

test("a teacher enters marks on the desktop grid, pasting a column from Excel", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chrome", "the grid is the desktop layout");
  const i = await ids();
  await signIn(page, "0711000003", "+254711000003"); // Grace Wanjiru: English in Grade 7 West
  await page.getByRole("button", { name: /^Staff/ }).click(); // she is a parent too
  await page.waitForURL(/\/dashboard/);
  await page.goto(`/dashboard/academics?term=${i.term}`);
  await page.getByRole("link", { name: /English · Grade 7 West/ }).click();
  const grid = page.getByTestId("mark-grid");
  await expect(grid).toBeVisible();
  const rows = grid.locator("tbody tr");
  const n = await rows.count();
  expect(n).toBeGreaterThan(5);

  // A column copied from Excel: one mark per line, the third student absent.
  const column = Array.from({ length: n }, (_, k) => (k === 2 ? "A" : String(27 - (k % 8)))).join(
    "\r\n",
  );
  const first = grid.locator('[data-cell="0-0"]');
  await first.focus();
  await first.evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, column);
  await expect(grid.locator('[data-cell="1-0"]')).toHaveValue("26");
  // 27 out of 30 is 90%: the level shows as it is typed.
  await expect(rows.first()).toContainText("EE1");
  await expect(rows.nth(2)).toContainText("Absent");

  // Typing: Enter moves down the column, Tab moves right.
  const end = grid.locator('[data-cell="0-2"]');
  await end.fill("85");
  await end.press("Enter");
  await expect(grid.locator('[data-cell="1-2"]')).toBeFocused();
  await page.keyboard.type("31");
  await page.keyboard.press("Tab");
  await expect(grid.locator('[data-cell="2-0"]')).toBeFocused();
  await grid.locator('[data-cell="1-1"]').fill("31"); // above 30: refused
  await expect(rows.nth(1)).toContainText("Above 30");
  await grid.locator('[data-cell="1-1"]').fill("24");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  const cat = await marksFor(i.g7West, i.english, "CAT 1");
  expect(cat).toHaveLength(n);
  expect(cat[0]).toMatchObject({ status: "score", score_tenths: 270 });
  expect(cat[2]).toMatchObject({ status: "absent", score_tenths: null });
  // Reloading shows what was saved.
  await page.reload();
  await expect(page.getByTestId("mark-grid").locator('[data-cell="0-2"]')).toHaveValue("85");
});

test("a teacher enters marks on a phone, one student per row", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-chrome", "the phone layout");
  const i = await ids();
  // Start from an empty sheet on every run (the Abs button toggles).
  await sql("DELETE FROM marks WHERE stream_id = $1 AND subject_id = $2", [i.g7West, i.science]);
  await signIn(page, "0711000009", "+254711000009"); // Daniel Ochieng: Integrated Science
  await page.goto(`/dashboard/academics/marks/${i.g7West}/${i.science}?term=${i.term}`);
  const list = page.getByTestId("mark-list");
  await expect(list).toBeVisible();
  await page.getByRole("tab", { name: "CAT 1" }).click();
  const items = list.getByRole("listitem");
  await items.nth(0).getByRole("textbox").fill("22");
  await expect(items.nth(0)).toContainText("ME1"); // 22/30 = 73%
  await items.nth(1).getByRole("textbox").fill("29.5");
  await items
    .nth(2)
    .getByRole("button", { name: /absent/ })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  const saved = await marksFor(i.g7West, i.science, "CAT 1");
  expect(saved.slice(0, 3).map((m) => [m.status, m.score_tenths])).toEqual([
    ["score", 220],
    ["score", 295],
    ["absent", null],
  ]);
});

test("the class teacher signs off, the Principal approves, and the stream prints as one PDF", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chrome", "runs once");
  const i = await ids();
  // Grade 8 East starts complete and in draft on every run (released results are final, so
  // the reset steps around the append-only triggers: test database only).
  await sql(`
    DO $$
    BEGIN
      SET LOCAL session_replication_role = replica;
      DELETE FROM report_cards WHERE stream_id = '${i.g8East}';
      UPDATE stream_results SET status = 'draft', signed_off_at = NULL, approved_at = NULL,
        released_at = NULL, signed_off_by_id = NULL, approved_by_id = NULL, released_by_id = NULL,
        returned_reason = NULL
      WHERE stream_id = '${i.g8East}';
    END $$`);
  const results = `/dashboard/academics/results/${i.g8East}?term=${i.term}`;

  await signIn(page, "0711000010", "+254711000010"); // Ruth Njoroge, class teacher
  await page.goto(results);
  await expect(page.getByTestId("completeness")).not.toContainText("submitted");
  await page.getByRole("button", { name: "Sign off this stream" }).click();
  // (The success message goes when the page refreshes; the steps list stays.)
  await expect(
    page.getByRole("listitem").filter({ hasText: "Class teacher signed off ·" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve results" })).toHaveCount(0);

  await fromUserMenu(page, page.getByRole("button", { name: "Sign out" }));
  await signIn(page, "0711000006", "+254711000006"); // Joseph Mwangi, Principal
  await page.goto(results);
  await page.getByRole("button", { name: "Approve results" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /Approved ·/ })).toBeVisible();
  await page.getByRole("button", { name: "Release report cards" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /Released ·/ })).toBeVisible();

  const [{ n }] = await sql<{ n: number }>(
    "SELECT count(*)::int AS n FROM students WHERE stream_id = $1 AND status = 'active'",
    [i.g8East],
  );
  const href = await page
    .getByRole("link", { name: "Print report cards (PDF)" })
    .getAttribute("href");
  // Fetched from the page (app.localhost only resolves in the browser).
  const { type, body } = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return { type: res.headers.get("content-type"), body: s };
  }, href!);
  expect(type).toBe("application/pdf");
  expect(body.startsWith("%PDF-")).toBe(true);
  expect(body.match(/\/Type \/Page\b/g)?.length).toBe(n);

  // Each card's QR code opens the public check on kiota.app: four facts, nothing else.
  const [card] = await sql<{ token: string; first_name: string }>(
    `SELECT r.token, s.first_name FROM report_cards r JOIN students s ON s.id = r.student_id
     WHERE r.stream_id = $1 ORDER BY s.admission_number LIMIT 1`,
    [i.g8East],
  );
  const check = await page.request.get(`${E2E_ENV.SITE_URL}/v/${card.token}`);
  expect(check.status()).toBe(200);
  await page.goto(`${E2E_ENV.SITE_URL}/v/${card.token}`);
  await expect(page.getByText("Genuine report card")).toBeVisible();
  await expect(page.getByTestId("verified")).toContainText(card.first_name);
  await expect(page.getByTestId("verified")).not.toContainText("%");
  const fake = await page.request.get(`${E2E_ENV.SITE_URL}/v/AAAAAAAAAAAAAAAAAAAAAAAA`);
  expect(fake.status()).toBe(404);
});
