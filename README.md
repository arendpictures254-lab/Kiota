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

Open http://localhost:3000 and sign in with a test number below. There is no real SMS in
development: the 6-digit code prints in the terminal running `npm run dev` (and is appended to
`.dev/sms-outbox.log`).

## Test phone numbers (development seed)

You can type them as `0711 000 001` or `+254711000001`.

| Phone        | Name          | School         | Role                                     |
| ------------ | ------------- | -------------- | ---------------------------------------- |
| 0700 000 001 | Arend Admin   | (platform)     | Arend Studio admin: creates schools      |
| 0711 000 001 | Amina Said    | Bahari Academy | Director                                 |
| 0711 000 002 | Peter Otieno  | Bahari Academy | Bursar                                   |
| 0711 000 003 | Grace Wanjiru | Bahari Academy | Class teacher                            |
| 0722 000 001 | John Kamau    | Milima School  | Director                                 |
| 0722 000 002 | Mary Achieng  | Milima School  | Bursar                                   |
| 0722 000 003 | David Kiprono | Milima School  | Class teacher                            |
| 0733 000 001 | Faith Njeri   | Both schools   | Subject teacher (sees the school picker) |

Each number can request 3 codes per 15 minutes.

Grace Wanjiru is class teacher of Grade 7 East, so she sees only those 15 students.

**Seeded students.** Bahari Academy has 61 students in Grade 7 and Grade 8 (East and West
streams), each with one or two guardians, plus houses, dormitories and the 2027 terms.
Wanjiku Kamau (0744 000 001) is a parent with Brian at Bahari Academy and Joy at Milima School;
her Milima link is waiting for her to confirm in the parent portal (a later phase). She cannot
sign in yet: parents get the portal later.

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
