# Launch checklist

Everything here must be done (or consciously decided) before Kiota goes live with a school.
Add to this list whenever something must happen before launch. Tick items off with a note.

## Database and hosting

- [ ] **Migration owner role.** The role that runs migrations owns the `SECURITY DEFINER` functions
      and must be a superuser or have `BYPASSRLS` on the production database host, otherwise the
      row-level security policies call themselves. Confirm the host allows this before choosing
      hosting.
- [ ] **Test with Docker Postgres** once Docker is installed (`npm run db:up`). So far everything
      was tested on PostgreSQL 17 via `embedded-postgres` (`npm run db:local`).
- [ ] **Set the `kiota_app` password** on the production database (the dev seed sets a known one).
- [ ] **Remove the pg deprecation warning** ("Calling client.query() when the client is already
      executing a query") if a fix is available in `@prisma/adapter-pg` / `pg`.

## Sign-in and security

- [ ] **Per-IP rate limit on sign-in code requests** (today: 3 codes per phone per 15 minutes only).
- [ ] **Real SMS driver** (Africa's Talking) behind `sendSms()`; the console driver refuses to run
      in production.
- [ ] **Staff names across schools.** When a school invites someone who already exists on the
      platform, the staff list shows the name another school typed. Store a per-school display name
      on the membership (as guardian links already do) before a second school goes live.

## Privacy between schools

- [ ] **Platform user names are readable by every school linked to that person.** Kiota shows
      each school its own name for a guardian (stored on the link), but the shared `users.name`
      (typed by the first school) can still be read by other schools through the database. Move
      display names fully to per-school records, or restrict that column, before a second school
      shares parents with the pilot school.

## Data import

- [ ] **Test the import with the pilot school's real file** (size and speed). Tested so far with
      the sample files and generated data only; one import runs in one transaction (3-minute limit).

## Files

- [ ] **S3-compatible storage driver** for student photos and documents. Today files go to the
      local disk (`.storage/`), which is lost on most hosts when the server is redeployed.
- [ ] **Backups of stored files** alongside the daily database backups.
