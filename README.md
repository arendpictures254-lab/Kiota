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
