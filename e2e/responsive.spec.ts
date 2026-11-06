/**
 * Every main screen at phone, tablet, laptop and large-display widths (and 320 px): it must
 * never scroll sideways. Screenshots are attached to the report (`npx playwright show-report`).
 * The committed before/after pictures come from `npm run screenshots` (docs/screenshots/).
 */
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { Client } from "pg";
import { E2E_ENV } from "../playwright.config";
import { type Ids, OVERFLOW_ONLY, PHONES, type Role, SCREENS, WIDTHS } from "./screens";

const SITE = E2E_ENV.SITE_URL;
const APP = E2E_ENV.APP_URL;

// The widths are set per screen, so one browser project is enough.
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chrome", "desktop only"));

let db: Client;
let ids: Ids;
let bahari: string;
const tokens = new Map<Role, string>();

test.beforeAll(async () => {
  db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  const one = async (sql: string, params: unknown[] = []) =>
    ((await db.query(sql, params)).rows[0] ?? {}) as Record<string, string>;
  bahari = (await one("SELECT id FROM schools WHERE name = 'Bahari Academy'")).id;
  const brian = (
    await one("SELECT id FROM students WHERE school_id = $1 AND admission_number = 'BA/2024/101'", [
      bahari,
    ])
  ).id;
  ids = {
    studentId: brian,
    receiptId: (
      await one("SELECT id FROM receipts WHERE school_id = $1 ORDER BY number DESC LIMIT 1", [
        bahari,
      ])
    ).id,
    brianLink: (
      await one(
        "SELECT g.id FROM guardian_links g JOIN users u ON u.id = g.user_id WHERE g.student_id = $1 AND u.phone = $2",
        [brian, PHONES.parent],
      )
    ).id,
    leaveoutId: (
      await one(
        "SELECT id FROM leaveouts WHERE school_id = $1 ORDER BY (status = 'out') DESC, created_at DESC LIMIT 1",
        [bahari],
      )
    ).id,
    g7East: (
      await one(
        "SELECT st.id FROM streams st JOIN classes c ON c.id = st.class_id WHERE st.school_id = $1 AND c.name = 'Grade 7' AND st.name = 'East'",
        [bahari],
      )
    ).id,
    morning: (
      await one("SELECT id FROM attendance_sessions WHERE school_id = $1 AND name = 'Morning'", [
        bahari,
      ])
    ).id,
  };
});

test.afterAll(async () => {
  await db.query("DELETE FROM sessions WHERE user_agent = 'Kiota responsive test'");
  await db.end();
});

/** A signed-in session made directly in the database: no sign-in codes needed for 34 screens. */
async function sessionFor(role: Role) {
  if (role === "anon") return null;
  if (tokens.has(role)) return tokens.get(role)!;
  const token = randomBytes(32).toString("base64url");
  const school = ["admin", "picker", "parent"].includes(role) ? null : bahari;
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, school_id, mode, expires_at, user_agent)
     SELECT $1, id, $2, $3, now() + interval '1 hour', 'Kiota responsive test' FROM users WHERE phone = $4`,
    [
      createHash("sha256").update(token).digest("hex"),
      school,
      role === "parent" ? "parent" : school ? "staff" : null,
      PHONES[role],
    ],
  );
  tokens.set(role, token);
  return token;
}

async function open(browser: Browser, role: Role) {
  const context = await browser.newContext();
  const token = await sessionFor(role);
  if (token) await context.addCookies([{ name: "kiota_session", value: token, url: APP }]);
  return context;
}

for (const screen of SCREENS) {
  test(`${screen.name} fits every width`, async ({ browser }, info) => {
    const context = await open(browser, screen.role);
    const page = await context.newPage();
    const url = (screen.host === "site" ? SITE : APP) + screen.path(ids);
    const tooWide: string[] = [];
    for (const w of [...WIDTHS, OVERFLOW_ONLY]) {
      await page.setViewportSize({ width: w.width, height: w.height });
      const res = await page.goto(url, { waitUntil: "networkidle" });
      expect(res?.status(), `${screen.name} loads`).toBeLessThan(400);
      // Signed-in screens must not have bounced to sign-in.
      if (screen.role !== "anon") expect(new URL(page.url()).pathname).not.toBe("/sign-in");
      const extra = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (extra > 1) tooWide.push(`${w.width}px: ${extra}px too wide`);
      if (w.width !== OVERFLOW_ONLY.width)
        await info.attach(`${screen.name}-${w.width}`, {
          body: await page.screenshot({ type: "jpeg", quality: 50 }),
          contentType: "image/jpeg",
        });
    }
    await context.close();
    expect(tooWide, `${screen.name} scrolls sideways`).toEqual([]);
  });
}
