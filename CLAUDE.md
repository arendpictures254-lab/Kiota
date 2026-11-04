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
- **Database:** PostgreSQL 17 (Docker Compose locally), Prisma 7 ORM with the `pg` driver adapter
- **Tests:** Vitest (unit, jsdom) and Playwright (end-to-end, mobile and desktop Chrome)
- **Quality:** ESLint (next config) and Prettier (with Tailwind class sorting)

## Folder layout

```
docs/spec.md            Product specification (source of truth for features)
prisma/schema.prisma    Database schema (models added module by module)
prisma.config.ts        Prisma CLI config (reads DATABASE_URL from .env)
src/app/                Routes, layouts, pages (App Router)
src/app/globals.css     Tailwind import and Kiota design tokens
src/lib/                Server and shared code (db client, money helpers...)
src/generated/prisma/   Generated Prisma client (gitignored, created by `prisma generate`)
public/brand/           Kiota logo files
e2e/                    Playwright end-to-end tests
docker-compose.yml      Local PostgreSQL
```

Unit tests sit next to the code they test as `*.test.ts(x)`.

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

## Naming conventions

- Files and folders: `kebab-case`. React components: `PascalCase`. Functions and variables: `camelCase`.
- Database tables and columns: `snake_case` (map with `@@map` / `@map` in Prisma), e.g. `school_id`.
- Money fields end in `_cents` (e.g. `amount_cents`) and are integers.

## Running things

First time:

```bash
npm install
cp .env.example .env
npm run db:up          # start Postgres in Docker
npx playwright install chromium
```

Day to day:

```bash
npm run dev            # app at http://localhost:3000
npm run db:migrate     # create/apply a migration after editing prisma/schema.prisma
npm run db:studio      # browse the database
npm run db:down        # stop Postgres
```

Checks (run before every commit):

```bash
npm run lint
npm run typecheck
npm run format:check   # or npm run format to fix
npm test               # Vitest unit tests
npm run test:e2e       # Playwright (starts the dev server itself)
npm run build
```

## How to work on this repo

- Build one module at a time in the spec's roadmap order. Each module starts with its data model
  and tests before any screens.
- Never commit `.env` or real school data.
