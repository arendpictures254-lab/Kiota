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
- [x] **Real SMS driver** (Africa's Talking) behind `sendSms()`. _Done (sandbox and live). The
      server refuses to start in production with the console driver or `ALLOW_CONSOLE_SMS=1`
      unless `KIOTA_DEMO=1` marks a demo server. Not yet tested against Africa's Talking itself:
      see Messaging below._

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
- [x] **Fee reminders:** _Done: the defaulters list sends real reminders (SMS, from the wallet,
      after a cost preview)._
- [ ] **Back-dated payments:** payments dated more than 120 days ago are refused; decide with the
      school how those are entered (today there is no override).
- [ ] **Receipt share links** (`/r/<token>`) never expire. Decide whether they should, before
      sending them to parents.

## Messaging (SMS, WhatsApp, wallet)

Details and exact settings: docs/messaging.md. These depend on third parties and take weeks.

- [ ] **Africa's Talking account** for Arend Studio verified; live API key in the password manager.
- [ ] **Test in the Africa's Talking sandbox** (`AT_ENVIRONMENT=sandbox`): a notice, a payment
      confirmation and a delivery report through the real callback URL. So far SMS was tested only
      with the console driver and `npm run sms:simulate`: no call has been made to AT yet.
- [ ] **Sender ID KIOTA** approved by Safaricom, Airtel and Telkom (sign-in codes).
- [ ] **The pilot school's sender ID** (e.g. its short name) approved by the networks, with the
      school's authorisation letter; entered and ticked "approved" under Admin → Messaging wallets.
- [ ] **Delivery report URL** set in the AT dashboard with a long random `SMS_CALLBACK_TOKEN`.
- [ ] **Prepaid credit on the Africa's Talking account** before opening day (the invitation SMS to
      every parent), with AT's low-balance alert on.
- [ ] **Confirm the licensing position for reselling bulk SMS** (Communications Authority).
- [ ] **Meta Business verification** for Arend Studio, a WhatsApp Business number and the "Kiota"
      display name approved.
- [ ] **WhatsApp templates approved by Meta** in English and Kiswahili (`kiota_payment_receipt`,
      `kiota_fee_reminder`, `kiota_notice`, `kiota_report_card`, `kiota_leaveout_alert`), each
      marked approved under Admin → Messaging wallets. Until then everything goes by SMS.
- [ ] **WhatsApp webhook** set in Meta with `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`;
      test one real template message, a receipt PDF, and a failure falling back to SMS.
- [ ] **Arend Studio's own Paybill or Till** from Safaricom, with Daraja Go Live for M-Pesa Express
      (STK Push) and its passkey: `PLATFORM_MPESA_*` set on the server. Never a school's Paybill.
- [ ] **A real KES 10 wallet top-up** by STK Push on that Paybill, checked against the Safaricom
      statement and the wallet page.
- [ ] **Prices per school** (per SMS unit and per WhatsApp message) set above Africa's Talking's and
      Meta's rates, plus the overdraft for critical messages and the pilot school's starter credit.
- [ ] **Quiet hours** (21:00 to 07:00) agreed with the pilot school, and which notices count as
      emergencies.
- [ ] **`QUIET_HOURS` is not "off"** and `ALLOW_CONSOLE_SMS` / `KIOTA_DEMO` are not set in
      production.

## Parent portal

Details: docs/parent-portal.md.

- [ ] **Native-speaker review of the Kiswahili text**: every string in `src/lib/i18n/sw.ts` (portal,
      sign-in, account), the Kiswahili SMS templates (`message_templates`, language "sw") and the
      offline page. They were written without a native speaker's check.
- [ ] **Test on the pilot parents' kind of phone**: a mid-range Android, Chrome, over Safaricom
      mobile data. Automated budget: the parent home shows in under 5 s on emulated slow 3G
      (measured: 1.4 s and 246 KB with an empty cache).
- [ ] **Install to the home screen on staging (https)**: check the icon, the name "Kiota", the
      teal bar and the offline page. Not testable over plain http.
- [ ] **Decide how long sessions last** for parents (30 days today, same as staff), and whether
      "Sign out everywhere" should also notify the parent by SMS.
- [ ] **Send the portal invitation on opening day** (Messages → Invite parents), then follow up
      with parents who have not signed in after a week.
- [ ] **Confirm with the pilot school** what a sponsor and other guardians should see (the
      guardian settings decide it), and which modules to switch on as they are built.
- [ ] **Receipt share links** never expire and the portal links to them (see "Before real money
      flows"): decide before launch.

## Leave-outs and the gate

Details: docs/leaveouts.md.

- [ ] **Two-way SMS for collector approvals.** The SMS asks parents to "Reply YES 1234", but an
      alphanumeric sender ID (e.g. BAHARI) cannot receive replies. Get a two-way short code or
      long number from Africa's Talking, point its incoming messages callback at
      `https://app.kiota.app/api/hooks/sms-in/<SMS_CALLBACK_TOKEN>`, and put that number in the
      template's wording. Until then, parents approve in the portal (it works already).
- [ ] **The Director grants "approve leave-outs"** to the pilot school's chosen staff (Staff →
      person), and assigns the gate guard and matron roles.
- [ ] **Student photos uploaded** before the first leave-out: the pass and the gate rely on them.
- [ ] **Test the gate on the guards' own phone, outside in daylight**: scanning printed A5 passes
      and phone screens, the photo fallback, and an exit with the phone in airplane mode synced
      later. Keep the gate phone charged and signed in.
- [ ] **A5 printing** of passes on the school's printer (check the QR code scans from paper).
- [ ] **Agree the rules with the school**: how early before the leave time the gate lets a child
      out (2 hours today), the reasons list (Half term, Weekend, Medical appointment, Family
      event, Bereavement, Other), and who is told when a student is late back.
- [ ] **Half term rehearsal**: issue passes for one class with the half-term tool, and run the
      gate's half-term mode with a queue of collectors.

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
