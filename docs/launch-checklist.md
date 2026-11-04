# Launch checklist

Everything here must be done (or consciously decided) before Kiota goes live with a school.
Add to this list whenever something must happen before launch. Tick items off with a note.

## Database and hosting

- [x] **Migration owner role.** The owner must be a superuser or have `BYPASSRLS`, otherwise the
      row-level security policies call themselves. _Resolved for the single-server setup in
      `docker-compose.prod.yml`: the owner (`kiota_owner`) is the PostgreSQL container's superuser.
      Re-check if Kiota ever moves to a managed database service._
- [x] **Set the `kiota_app` password.** _Set from `APP_DB_PASSWORD` by the `migrate` service on
      every deploy (`scripts/deploy-setup.ts`)._
- [ ] **Test the Docker setup** (`docker-compose.prod.yml`, `npm run db:up`) on a real server.
      Not yet run anywhere: Docker is not installed on the development machine. Everything else was
      tested on PostgreSQL 17 via `embedded-postgres`, and the standalone server build was tested
      with production-style addresses.
- [ ] **Choose hosting in or near Kenya** and record it in the data processing agreement.
- [ ] **Encryption at rest.** Confirm the server's disk is encrypted (provider setting), and that
      off-server backup copies are encrypted.
- [ ] **Practise a restore** from backup on staging (docs/deploy.md, section 9).
- [ ] **Set up off-server backup copies** (rsync or rclone, docs/deploy.md).
- [ ] **Uptime monitoring** on `https://app.kiota.app/api/health`.
- [ ] **Remove the pg deprecation warning** ("Calling client.query() when the client is already
      executing a query") if a fix is available in `@prisma/adapter-pg` / `pg`.

## Sign-in and security

- [ ] **Per-IP rate limit on sign-in code requests** (today: 3 codes per phone per 15 minutes only).
- [ ] **Real SMS driver** (Africa's Talking) behind `sendSms()`. The console driver refuses to run
      in production unless `ALLOW_CONSOLE_SMS=1`, which is for staging only: turn it off before
      real users arrive.

## Before real money flows (fees and M-Pesa)

- [ ] **Daraja Go Live for the pilot school's Paybill.** Production consumer key/secret, passkey,
      initiator and security credential from the Daraja portal; environment set to **Live**;
      **Register with Safaricom** pressed. See docs/mpesa.md.
- [ ] **End-to-end test with real money on the live Paybill:** a KES 10 Paybill payment with the
      admission number, a wrong account number (lands in suspense, then assign it), an STK prompt,
      and one reversal. Check each receipt and the Director's notification.
- [ ] **Test in the Daraja sandbox first** through a Cloudflare quick tunnel (docs/mpesa.md). So far
      M-Pesa was tested only with the local simulator: no call has been made to Safaricom yet.
- [ ] **`CREDENTIALS_ENCRYPTION_KEY`** generated for production (`openssl rand -hex 32`), stored in a
      password manager **separately from the database backups**. Losing it means re-entering every
      school's Daraja credentials; leaking it plus a backup exposes them.
- [ ] **`ALLOW_MPESA_SIMULATOR` is not set** in production (the simulator driver refuses to run
      there without it).
- [ ] **Restrict the callback URLs to Safaricom's published callback IP addresses** in Caddy, as a
      second layer on top of the secret token and the transaction status check.
- [ ] **Opening balances checked against the school's books** before pressing "Post opening
      balances" (it can only be done once; corrections afterwards are one-off charges or credits).
- [ ] **Vote head priority order agreed with the Bursar and auditor** (it decides how every payment
      is split), and the "collected for a term" rule (older balances are cleared first) explained.
- [ ] **Daily reconciliation in the first weeks:** compare the M-Pesa statement from the Safaricom
      org portal with Kiota's daily collection report, and clear suspense every day.
- [ ] **Print a thermal receipt on the pilot school's own printer** (80 mm) and an A4 receipt, and
      upload the school's crest (School setup → School crest).
- [ ] **Fee reminders:** "Send reminder" on the defaulters list is a stub (it records the request in
      the audit log). Wire it to SMS/WhatsApp before telling the school it works.
- [ ] **Back-dated payments:** payments dated more than 120 days ago are refused; decide with the
      school how those are entered (today there is no override).
- [ ] **Receipt share links** (`/r/<token>`) never expire. Decide whether they should, before
      sending them to parents.

## Public website

- [ ] **Lawyer review of the privacy policy and terms** (kiota.app/privacy and /terms are marked
      "DRAFT — to be reviewed by a lawyer before launch"). Remove the draft notice afterwards.
- [ ] **Notification for new demo requests** by email or WhatsApp to Arend Studio. Today they only
      appear on the admin "Demo requests" page.
- [ ] **Register with the Office of the Data Protection Commissioner** (the privacy policy says
      "registered or registering"; update it once registered).

## Data import

- [ ] **Test the import with the pilot school's real file.** Benchmark: 1,000 students and 1,600
      guardians import in about 4 seconds locally (`npm run bench:import`), well inside the
      3-minute limit, but the real file's content has not been seen yet.

## Files

- [ ] **S3-compatible storage driver** for student photos and documents. Today files go to the
      local disk (a Docker volume on the server), which is backed up nightly with the database.
- [x] **Backups of stored files** alongside the daily database backups. _Done: the `backup`
      service archives the storage volume every night with the database dump, kept 14 days._
