# Kiota

Kiota (Swahili for "nest") is a multi-school school management system for Kenyan schools, from
pre-primary to senior school, built and owned by Arend Studio and hosted at kiota.app. One platform
serves many schools, each walled off from the others. It runs fees and receipts (M-Pesa), academics
and report cards (CBC and 8-4-4, configured per school), a parent portal, SMS and WhatsApp messaging,
and leads the market on boarding: leave-outs, dormitories, pocket money, sick bay and stores. The
pilot is a boarding school in Kilifi, live from Term 1, January 2027. The full product spec is in
[docs/spec.md](docs/spec.md); read it before starting any module.

@AGENTS.md

## Non-negotiable rules

These come from the spec. When a feature conflicts with one, the rule wins.

1. **School walls.** Every table holding school data has a `school_id`; every query is scoped to it;
   PostgreSQL row-level security enforces it so anything that slips through is blocked.
2. **Parents are platform-level users**, linked to students only through a guardian link table.
   That link is the only way a parent reaches school data.
3. **Money is integer cents.** Never floats. Payments, receipts and reversals are append-only:
   never updated or deleted. Mistakes are corrected by a reversal with a reason, a name and a time.
4. **Configuration, not code.** Grading schemes, levels, subjects, fee items and report templates
   are configuration data, never hard-coded constants.
5. **Audit log.** Every money, marks, leave-out and permissions action is recorded: who, what, when.
6. **Server-side permissions.** Permissions are checked on the server for every action, never only
   hidden in the UI.
7. **Simple enough for anyone.** One primary action per screen, mobile first (mid-range Android over
   mobile data), plain English, with Kiswahili support planned (keep UI strings out of logic so they
   can be translated).

Tests are required for money (allocations, reversals, balances), permissions and school walls,
including a test proving school A can never read school B's data.

## Stack

- **App:** Next.js 16 (App Router, Server Components), React 19, TypeScript in strict mode
- **Styling:** Tailwind CSS v4, brand tokens defined in `src/app/globals.css` (`@theme`)
- **Database:** PostgreSQL 17 (Docker Compose or embedded-postgres locally), Prisma 7 with the `pg` driver adapter, row-level security per school
- **Sign-in:** phone number + 6-digit SMS code; session cookie (random token, hash stored)
- **Tests:** Vitest (unit, jsdom) and Playwright (end-to-end, mobile and desktop Chrome)
- **Quality:** ESLint (next config) and Prettier (with Tailwind class sorting)

## Folder layout

```
docs/spec.md                  Product specification (source of truth for features)
prisma/schema.prisma          Database schema
prisma/migrations/            SQL migrations, incl. row-level security (`*_school_walls`)
prisma/seed.ts                Development seed (two schools, test phone numbers in README)
prisma/setup.ts               Owner-only helpers: permission catalogue sync, app role login
prisma.config.ts              Prisma CLI config (owner connection: DATABASE_URL)
src/app/                      Routes (sign-in, schools picker, dashboard, staff, admin)
src/app/globals.css           Tailwind import and Kiota design tokens
src/components/               Shared UI (ui.tsx: Button, Field, Card, Shell...)
src/lib/db.ts                 App database access (kiota_app role): db(ctx), inContext(ctx, fn)
src/lib/db-core.ts            Client factory and the school-context Prisma extension
src/lib/auth/                 Permission catalogue, permission checks, OTP, sessions, context
src/lib/staff/service.ts      Staff and school admin logic (permission-checked, audited)
src/lib/sms/                  sendSms() interface and drivers (console for development)
src/lib/audit.ts              audit(tx, entry): append to the audit log in the same transaction
src/generated/prisma/         Generated Prisma client (gitignored, `npm run db:generate`)
tests/                        Database test setup and helpers
e2e/                          Playwright end-to-end tests
scripts/dev-db.ts             Local PostgreSQL without Docker (`npm run db:local`)
docker-compose.yml            Local PostgreSQL with Docker (`npm run db:up`)
```

Unit tests sit next to the code as `*.test.ts(x)`; tests that need PostgreSQL are `*.db.test.ts`.

## School walls: how to write data code

- The app connects as `kiota_app` (APP_DATABASE_URL): not the owner, not a superuser, no
  BYPASSRLS. Migrations and the seed use the owner (DATABASE_URL). Never use the owner in app code.
- Every school-owned table gets `school_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy
  `school_id = (SELECT app_current_school())`, written by hand in a migration, plus GRANTs to
  `kiota_app`. The test "every table with a school_id column has row-level security" fails
  otherwise.
- Queries run with a context: `db({ userId, schoolId })` for reads, `inContext(ctx, tx => ...)` for
  writes. Both set `app.user_id` / `app.school_id` with `set_config(..., true)` in a transaction.
  `app_current_school()` only accepts the school if the user is an active member (or an Arend admin
  while the school's support access is on), so a wrong school id sees nothing.
- Platform tables without RLS: `otp_codes`, `sessions`, `permissions` (no school data).
- Privileged steps (sign-in lookup, school picker, creating schools, finding a user by phone)
  go through narrow `SECURITY DEFINER` SQL functions (`app_*`) in the migrations.
- Server actions: load the context with `requireSchool()` / `requirePermission()` from
  `src/lib/auth/context.ts`, then call a service function that checks permissions again and
  writes the audit log in the same transaction. Check permissions, never role names.
- Permissions and built-in roles live in `src/lib/auth/catalog.ts` and are synced to the
  database by the seed. `leaveout.approve` is director-grant-only (granted person by person).
- The database client pins `TimeZone=UTC`; keep it (the pg adapter sends timestamps without an offset).

## Brand

Use the Tailwind tokens, never raw hex values in components.

| Token                  | Hex     | Use                       |
| ---------------------- | ------- | ------------------------- |
| `teal` / `primary`     | #1F5F63 | Primary actions, headings |
| `egg-blue`             | #A9DCD6 | Soft accents              |
| `light-twig`           | #C9A27A | Accents                   |
| `twig`                 | #7A5634 | Accents                   |
| `cream` / `background` | #FBF7F0 | Page background           |
| `ink` / `foreground`   | #1E2422 | Body text                 |
| `status-paid`          | #2E8B57 | Paid                      |
| `status-due`           | #D9921A | Due                       |
| `status-overdue`       | #C0392B | Overdue                   |

Fonts: Syne for headings (`font-heading`, applied to h1–h4 by default), DM Sans for body
(`font-sans`), both loaded with `next/font` in `src/app/layout.tsx`.

Next.js 16 has `cacheComponents` on: anything that reads cookies or the database goes in an async
component inside `<Suspense>` (see the existing pages).

## Naming conventions

- Files and folders: `kebab-case`. React components: `PascalCase`. Functions and variables: `camelCase`.
- Database tables and columns: `snake_case` (map with `@@map` / `@map` in Prisma), e.g. `school_id`.
- Money fields end in `_cents` (e.g. `amount_cents`) and are integers.
- Audit actions: `area.verb`, e.g. `staff.invite`, `permission.grant`, `school.create`.

## Running things

First time:

```bash
npm install
cp .env.example .env
npm run db:up          # Postgres in Docker, or `npm run db:local` without Docker (keep it running)
npm run db:migrate     # apply migrations (as the owner)
npm run db:seed        # catalogue, app role login, two test schools
npx playwright install chromium
```

Day to day:

```bash
npm run dev            # app at http://localhost:3000; sign-in codes print in this terminal
npm run db:migrate     # create/apply a migration after editing prisma/schema.prisma
npm run db:generate    # regenerate the Prisma client (Prisma 7 does not do it on migrate)
npm run db:studio      # browse the database
```

Checks (run before every commit; Postgres must be running):

```bash
npm run lint
npm run typecheck
npm run format:check   # or npm run format to fix
npm test               # Vitest: unit + database tests (database `kiota_test`)
npm run test:e2e       # Playwright: builds the app, runs it on :3101 against `kiota_e2e`
npm run build
```

## How to work on this repo

- Build one module at a time in the spec's roadmap order. Each module starts with its data model
  and tests before any screens.
- Tests are required for money, permissions and school walls.
- Never commit `.env` or real school data.
