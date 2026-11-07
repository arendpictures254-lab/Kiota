# Kiota

Every child, one place. School management for Kenyan schools, by Arend Studio.

- Product spec: [docs/spec.md](docs/spec.md)
- Setup, commands and the rules every change follows: [CLAUDE.md](CLAUDE.md)

## Quick start

```bash
npm install
cp .env.example .env
npm run db:up        # PostgreSQL in Docker. No Docker? Use `npm run db:local` in its own terminal.
npm run db:migrate
npm run db:seed
npm run dev
```

Two addresses, like production (kiota.app and app.kiota.app):

- **Public site:** http://localhost:3000
- **App (sign in):** http://app.localhost:3000

Chrome, Edge and Firefox resolve `app.localhost` to your own computer automatically. Sign in
with a test number below. There is no real SMS in
development: the 6-digit code prints in the terminal running `npm run dev` (and is appended to
`.dev/sms-outbox.log`).

## Test phone numbers (development seed)

You can type them as `0711 000 001` or `+254711000001`.

| Phone        | Name                   | School         | Role                                     |
| ------------ | ---------------------- | -------------- | ---------------------------------------- |
| 0700 000 001 | Arend Admin            | (platform)     | Arend Studio admin: creates schools      |
| 0711 000 001 | Amina Said             | Bahari Academy | Director                                 |
| 0711 000 002 | Peter Otieno           | Bahari Academy | Bursar                                   |
| 0711 000 003 | Grace Wanjiru          | Bahari Academy | Class teacher, and Kibet's mother        |
| 0711 000 004 | Hassan Ali             | Bahari Academy | Gate guard: sees only the gate scanner   |
| 0711 000 005 | Mercy Chebet           | Bahari Academy | Boarding master, may approve leave-outs  |
| 0711 000 006 | Joseph Mwangi          | Bahari Academy | Principal: attendance, staff attendance  |
| 0711 000 007 | Zawadi Mohamed         | Bahari Academy | Matron: boarder alerts                   |
| 0711 000 008 | Lucy Wambui            | Bahari Academy | School secretary: photos and ID cards    |
| 0711 000 009 | Daniel Ochieng         | Bahari Academy | Class teacher, Grade 7 West              |
| 0711 000 010 | Ruth Njoroge           | Bahari Academy | Class teacher, Grade 8 East              |
| 0711 000 011 | Omar Hassan            | Bahari Academy | Storekeeper                              |
| 0711 000 012 | Esther Achieng         | Bahari Academy | Cook: today's meals, number served       |
| 0722 000 001 | John Kamau             | Milima School  | Director                                 |
| 0722 000 002 | Mary Achieng           | Milima School  | Bursar                                   |
| 0722 000 003 | David Kiprono          | Milima School  | Class teacher                            |
| 0733 000 001 | Faith Njeri            | Both schools   | Subject teacher (sees the school picker) |
| 0744 000 001 | Wanjiku Kamau          | Both schools   | Parent (Brian at Bahari, Joy at Milima)  |
| 0755 000 001 | Kilifi Education Trust | Bahari Academy | Sponsor: sees fees only                  |

Each number can request 3 codes per 15 minutes.

Grace Wanjiru is class teacher of Grade 7 East, so she sees only those 15 students.

**Seeded students.** Bahari Academy has 61 students in Grade 7 and Grade 8 (East and West
streams), each with one or two guardians, plus houses, dormitories and the 2027 terms.
Wanjiku Kamau (0744 000 001) is a parent with Brian at Bahari Academy and Joy at Milima School;
her Milima link waits for her to confirm in the parent portal (docs/parent-portal.md).

**Seeded leave-outs** (Bahari Academy, docs/leaveouts.md): one approved pass for today
(BA/2025/011, ready to scan), one student out (BA/2025/012), one overdue back (BA/2025/013),
a declined request, and Wanjiku's request for Brian waiting for Mercy to approve. Pickup codes
go to the collectors by (console) SMS: see `.dev/sms-outbox.log`.

## Trying the import

Sign in as Amina Said (0711 000 001), open **Students → Import from Excel**.

1. **Download template** gives an .xlsx with a README sheet and dropdowns for your classes.
2. Upload [docs/samples/kiota-import-sample-with-errors.xlsx](docs/samples/kiota-import-sample-with-errors.xlsx)
   to see how problems are explained (bad phone, unknown stream, duplicate admission number,
   impossible date of birth, unknown relationship).
3. Upload [docs/samples/kiota-import-sample.xlsx](docs/samples/kiota-import-sample.xlsx): no
   errors, two warnings (a new house, a student with no guardian). Press **Import**.
4. Search for "Rehema" in Students. Uploading the same file again updates, never duplicates.

The samples are written for the seeded Bahari Academy; rebuild them with `npm run samples`.

## Trying fees

The seed gives Bahari Academy Term 1 2027 fees: fee structures, invoices for every student,
a mix of M-Pesa / cash / bank payments, one reversal, three M-Pesa payments in suspense, a pledge
and a few students who owe everything.

- **Bursar** (Peter Otieno, 0711 000 002): **Fees → Record a payment** (e.g. admission
  `BA/2025/002`, cash) → the receipt opens: switch Thermal / A4, **Print**, **Download PDF**,
  copy the share link, or **Reverse** it with a reason. **Fees → M-Pesa** shows suspense payments
  to assign and lets you send an M-Pesa prompt.
- **Director** (Amina Said, 0711 000 001): a notification about the reversal on the dashboard;
  **Fees → Reports**: collected vs expected, defaulters (with "send reminder"), daily collection
  and the Excel export for the auditor.
- **Simulated M-Pesa** (with `npm run dev` running):

  ```bash
  npm run mpesa:simulate -- c2b --account BA/2025/005 --amount 2500
  ```

  The payment appears under Fees → Payments with a receipt. See [docs/mpesa.md](docs/mpesa.md)
  for every command and for testing against the real Daraja sandbox.

## If `npm run dev` stops on Windows

What we measured on a 16 GB Windows laptop (November 2026):

- The dev server grows to about **4 GB** of memory once every screen has been compiled
  (Turbopack keeps each compiled route in memory). With Postgres, Chrome, the test suites and
  Playwright running at the same time, free memory dropped below 0.5 GB, and once Turbopack
  crashed with _"OS can't spawn worker thread: Insufficient system resources (os error 1450)"_.
- Every other "random" stop had exit code 127 and no message, the signature of the process being
  **ended from outside** (stopping whatever listens on port 3000, a closed terminal, or a tool
  cleaning up its background processes). It is not Next's memory auto-restart (that prints
  "approaching the used memory threshold"), and not `next typegen` or `next build` running
  alongside (both tested: the dev server kept running).

What to do:

1. Run `npm run dev` in **its own terminal** and leave it there.
2. Don't run `npm test`, `npm run test:e2e` or `npm run build` while you click around in dev on a
   16 GB machine; or give the dev server room by closing other heavy programs.
3. Add the project folder to the **Microsoft Defender exclusions** (Next's own advice for
   Windows), or use a Dev Drive: fewer file-watch delays.
4. For long screenshot runs, use the production build: `npm run build`, then `npm start`
   (production checks need real secrets: see docs/deploy.md).
5. `npm run typecheck` already gives TypeScript 4 GB (it needs about 900 MB for this project).

## Deploying

See [docs/deploy.md](docs/deploy.md) for a single Ubuntu server with Docker, Caddy (automatic
HTTPS) and nightly backups, and [docs/launch-checklist.md](docs/launch-checklist.md) for what must
happen before a school goes live.
