/**
 * Screenshots of every main screen at phone, tablet, laptop and desktop widths:
 *
 *   npm run screenshots -- docs/screenshots/after        (a running dev server on :3000)
 *   ONLY=dashboard-director,gate npm run screenshots -- <dir>     (just these screens)
 *   W=1366,390 npm run screenshots -- <dir>                       (just these widths)
 *
 * Signs people in by creating sessions straight in the development database (no SMS codes), so
 * it never trips the sign-in rate limit. Viewport (above-the-fold) JPEGs, small enough to keep in
 * the repository. Also reports any page that scrolls sideways.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import { OVERFLOW_ONLY, PHONES, type Role, SCREENS, WIDTHS } from "../e2e/screens";
import { createClient } from "../src/lib/db-core";

const out = path.resolve(process.argv[2] ?? "docs/screenshots/after");
const APP = process.env.SCREENSHOT_APP_URL ?? "http://app.localhost:3000";
const SITE = process.env.SCREENSHOT_SITE_URL ?? "http://localhost:3000";

async function main() {
  const owner = createClient(process.env.DATABASE_URL);
  const bahari = await owner.school.findFirstOrThrow({ where: { name: "Bahari Academy" } });
  const user = (phone: string) => owner.user.findUniqueOrThrow({ where: { phone } });

  async function sessionFor(role: Role) {
    if (role === "anon") return null;
    const u = await user(PHONES[role]);
    const token = randomBytes(32).toString("base64url");
    const school = ["admin", "picker", "parent"].includes(role) ? null : bahari.id;
    await owner.session.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        userId: u.id,
        schoolId: school,
        mode: role === "parent" ? "parent" : school ? "staff" : null,
        expiresAt: new Date(Date.now() + 3600_000),
        userAgent: "Kiota screenshots",
      },
    });
    return token;
  }

  const wanjiku = await user(PHONES.parent);
  const brian = await owner.student.findFirstOrThrow({
    where: { schoolId: bahari.id, admissionNumber: "BA/2024/101" },
  });
  const ids = {
    studentId: brian.id,
    receiptId: (
      await owner.receipt.findFirstOrThrow({
        where: { schoolId: bahari.id },
        orderBy: { number: "desc" },
      })
    ).id,
    brianLink: (
      await owner.guardianLink.findFirstOrThrow({
        where: { studentId: brian.id, userId: wanjiku.id },
      })
    ).id,
    leaveoutId: (
      await owner.leaveout.findFirstOrThrow({ where: { schoolId: bahari.id, status: "out" } })
    ).id,
    g7East: (
      await owner.stream.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "East", class: { name: "Grade 7" } },
      })
    ).id,
    morning: (
      await owner.attendanceSession.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "Morning" },
      })
    ).id,
    term3: (
      await owner.term.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "Term 3", academicYear: { name: "2026" } },
      })
    ).id,
    g7West: (
      await owner.stream.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "West", class: { name: "Grade 7" } },
      })
    ).id,
    g8East: (
      await owner.stream.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "East", class: { name: "Grade 8" } },
      })
    ).id,
    english: (
      await owner.subject.findFirstOrThrow({
        where: { schoolId: bahari.id, name: "English", level: { key: "junior" } },
      })
    ).id,
    g7EastStudent: (
      await owner.student.findFirstOrThrow({
        where: { schoolId: bahari.id, stream: { name: "East", class: { name: "Grade 7" } } },
        orderBy: { admissionNumber: "asc" },
      })
    ).id,
  };

  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const contexts = new Map<Role, BrowserContext>();
  const overflow: string[] = [];
  try {
    const only = process.env.ONLY?.split(",").filter(Boolean);
    for (const screen of SCREENS.filter((x) => !only || only.includes(x.name))) {
      let ctx = contexts.get(screen.role);
      if (!ctx) {
        ctx = await browser.newContext({ deviceScaleFactor: 1 });
        const token = await sessionFor(screen.role);
        if (token) await ctx.addCookies([{ name: "kiota_session", value: token, url: APP }]);
        contexts.set(screen.role, ctx);
      }
      const page = await ctx.newPage();
      const widths = process.env.W?.split(",").map(Number);
      for (const w of [...WIDTHS, OVERFLOW_ONLY].filter(
        (x) => !widths || widths.includes(x.width),
      )) {
        await page.setViewportSize({ width: w.width, height: w.height });
        const url = (screen.host === "site" ? SITE : APP) + screen.path(ids);
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
        if (!res || res.status() >= 400) throw new Error(`${url} answered ${res?.status()}`);
        await page.waitForTimeout(400);
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (wide > 1) overflow.push(`${screen.name} @ ${w.width}px: ${wide}px too wide`);
        if (w.width === OVERFLOW_ONLY.width) continue; // 320 px: checked, not photographed
        await page.screenshot({
          path: path.join(out, `${screen.name}-${w.width}.jpg`),
          type: "jpeg",
          quality: 50,
        });
      }
      await page.close();
      console.log("captured", screen.name);
    }
  } finally {
    await browser.close();
    await owner.session.deleteMany({ where: { userAgent: "Kiota screenshots" } });
    await owner.$disconnect();
  }
  console.log(
    overflow.length
      ? `\nSIDEWAYS SCROLLING:\n${overflow.join("\n")}`
      : "\nNo page scrolls sideways.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
