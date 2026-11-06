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

## Deploying

See [docs/deploy.md](docs/deploy.md) for a single Ubuntu server with Docker, Caddy (automatic
HTTPS) and nightly backups, and [docs/launch-checklist.md](docs/launch-checklist.md) for what must
happen before a school goes live.
