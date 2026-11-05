# The parent portal

Parents sign in at app.kiota.app with their phone number and an SMS code, the same as staff.
There is no sign-up: a number no school has added is told to contact the school.

## What a parent sees

- **All children** (home): the family's total fee balance across every school, and what needs
  attention: a second school asking to add a child, fees overdue, new notices.
- **The child switcher** at the top: photo (or initials), first name, class and school.
- **Per child**: fees (balance, what it is made of by vote head, invoices with instalment dates,
  every payment with its receipt to view or download), **Pay with M-Pesa**, and notices from the
  school (newest first, mark as read). Report cards, leave-outs and pocket money appear as
  "coming soon" only for schools with those modules on (Arend admin → school → Modules).
- What each guardian sees follows the school's settings for them: a sponsor with "fees only" sees
  only fees; a guardian who does not receive fees does not see them.
- **Account**: language (English or Kiswahili; also used for the schools' SMS to them), where they
  are signed in, and "Sign out everywhere".

Someone who is both staff and a parent (a teacher whose child is at the school) chooses
**Staff** or **Parent** after signing in, and switches with "Staff view" / "Parent view".

## How the walls hold

A parent has no membership in any school, so they never get a school context. Every portal read
goes through a database function (`app_my_children`, `app_parent_fees`, `app_parent_notices`,
`app_parent_child_photo`, `app_parent_stk_status`) that starts from the caller's own guardian
link. A school sees only its own students, its own name for the parent, and whether they have
signed in. It never learns about the parent's other schools.

**A second school.** When a school adds a child to a number that is already a parent at another
school, the link waits for the parent. The portal shows only "Milima School wants to add Joy to
your account". The parent confirms with a fresh SMS code, or declines. Declining tells that
school's Director, using the school's own name for the parent, and nothing else.

**Paying.** The prompt goes to the child's own school's Paybill, with the admission number as the
account, and runs as that school's automatic-payments member. Each payment is confirmed with
Safaricom before it is posted, as with every M-Pesa payment. The parent's page checks every
3 seconds, shows the receipt as soon as it is posted, and gives up waiting after 2 minutes. The
receipt still appears under Fees if the payment comes later.

## For schools

- **Messages → Invite parents to Kiota**: everyone, a class or a stream; by default only parents
  who have not signed in yet. Preview the recipients and cost, then send. Each parent gets one
  SMS in their language. Below it: who has signed in, and who has not (with their numbers).
- **Messages → Recent notices**: "Read by N of M" for each notice.

## Trying it on a phone over Wi-Fi

1. Connect the phone to the same Wi-Fi as this computer.
2. Run `npm run dev:phone` (stop `npm run dev` first: one dev server per folder). It prints the
   address to open on the phone, such as `http://192.168.100.35:3000`. If the phone cannot reach
   it, allow Node.js through the Windows firewall for private networks.
3. Sign in as Wanjiku Kamau, **0744 000 001**. The code prints in that terminal and in
   `.dev/sms-outbox.log`.
4. To pay, press **Pay with M-Pesa**, then run `npm run mpesa:simulate -- stk` on the computer
   (this is the parent entering their PIN). The phone shows the receipt.

Other seeded people: the sponsor **0755 000 001** (fees only), and Grace Wanjiru **0711 000 003**
(teacher and parent, so she chooses Staff or Parent).

While `dev:phone` runs, the app is at the Wi-Fi address and not at app.localhost.

Installing to the home screen needs https, so try it on staging, not over plain http.
The service worker (`public/sw.js`) caches only the offline page, never fees or notices.
