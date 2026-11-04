# Kiota — Product Specification

Oct 22, 2026 · Created by Melchzedeck Anzigale and Paul Nyaga · Arend Studio

## Overview

Arend Studio is building Kiota, a school management system that runs fees, academics, parent communication, boarding and stores for Kenyan schools from primary to senior school. A boarding school in Kilifi is the pilot: its data is loaded in December 2026 and it runs on the system from Term 1, January 2027. Arend Studio owns the product and will sell it to other schools. Kiota (Swahili for "nest") will live at kiota.app.

**Positioning.** Existing systems compete on exam analytics and fee collection. None is built around running a boarding school. This system does both basics well and owns boarding: leave-out, dormitories, pocket money, sick bay, food stores and parent alerts.

**Goals for the pilot**

- The bursar records every payment in the system and issues every receipt from it.
- Every parent can see fee balance, receipts and results on their phone.
- Term 1 report cards are produced and delivered through the system.
- Every leave-out goes through the system, with SMS to parents on exit and return.
- The school agrees to be a reference case study for Arend Studio's sales to other schools.

## Design principles

Five rules decide every build choice; when a feature conflicts with one, the rule wins.

1. **Simple enough for anyone.** Each role sees only its own work. Every common task takes three taps or fewer. Plain English and Kiswahili, no jargon.
2. **Regulations live in settings, not code.** Grading scales, curricula, levels, subjects, terms, report layouts and fee items are data the school or Arend Studio configures. A new Ministry directive is a settings update, not a rebuild.
3. **Multi-school from day one.** One platform hosts many schools. Each school's data is walled off from every other school.
4. **Built for Kenyan phones.** Fast on a mid-range Android over mobile data. Pages stay light, and key screens keep working on a weak connection.
5. **Money records are permanent.** Receipts and payments are never edited or deleted, only reversed with a reason and a name. Every sensitive action is logged.

## Users and roles

Eleven roles cover the pilot; a school can give one person several roles, and each role opens to its own home screen.

| Role | What they see and do |
| --- | --- |
| Director | Everything in their school. Dashboards for fees, academics, boarding and stores. Assigns roles, including who may approve leave-outs. |
| Principal / head teacher | Academics, discipline, attendance, notices, leave-out approvals if granted. No editing of money records. |
| Bursar | Fee structures, payments, receipts, reversals, statements, fee reminders, collections dashboard. |
| Accounts clerk | Records payments and issues receipts. Cannot reverse or change fee structures. |
| Class teacher | Their class: attendance, marks, comments, report card sign-off, leave-out requests. |
| Subject teacher | Mark entry and analysis for the subjects and classes they teach. |
| Boarding master / matron | Dormitories, roll calls, leave-out requests, sick bay, pocket money. |
| Storekeeper | Stock in, stock out, uniform issue, food store usage per meal. |
| Gate guard | One screen: scan or search a gate pass, mark exit and return. |
| Parent / guardian | Parent portal: their children's fees, results, analytics, leave-outs and notices. |
| Arend Studio admin | Platform level: onboards schools, manages messaging wallets and sender IDs, support. No access to school data unless the school grants support access. |

Access is permission-based under the hood, so a school can make a custom role (for example a deputy who approves leave-outs only) without code changes.

## Students, guardians and school structure

Every other module hangs off one student record and one configurable school structure.

**School structure (configurable per school)**

- Levels: pre-primary, primary (Grades 1–6), junior school (Grades 7–9), senior school (Grades 10–12), and legacy 8-4-4 Forms 3–4 during the transition.
- Classes and streams (Grade 7 East, Form 4 North), houses and dormitories.
- Academic years and terms with dates, including half-term and visiting days.
- Subjects and learning areas per level; senior school pathways with per-student subject combinations.

**Student record**

- Admission number, UPI (NEMIS number), name, photo, date of birth, gender, level, class, stream.
- Boarder or day scholar, dormitory and bed, house.
- Medical notes and allergies (restricted to sick bay and leadership), special needs.
- Status: active, transferred, graduated, suspended, withdrawn. Records are archived, never deleted.
- Documents: birth certificate, previous school reports, transfer letters.

**Guardians**

- A student can have several guardians (mother, father, guardian, sponsor), each with a phone number and preferred language.
- Per guardian, the school sets what they receive: fees, academics, boarding alerts. This handles separated parents and sponsors who pay but should not see results.
- Per guardian, a flag for **authorised to collect** the child at leave-out.

**Bulk import.** Schools onboard from an Excel template: students, guardians, classes and opening fee balances. The import checks for duplicates and missing phone numbers before anything is saved.

## Fees and finance

Every shilling a parent pays lands on the right student, the right vote head and a permanent receipt, with no manual matching.

**Fee structures**

- Fee items grouped into vote heads (tuition, boarding, activity, transport, uniform, exam, development), set per level, per term, and per boarder or day scholar.
- Automatic term invoices for every student when a term opens; one-off charges (trip, replacement uniform, damages) added to individual students.
- Installment plans with due dates, sibling discounts, bursaries and scholarships (full or partial, with the sponsor recorded).
- Opening balances and overpayments carried forward between terms.

**Collecting payments**

- **M-Pesa Paybill:** the parent pays with the admission number as the account number; the payment posts to the student automatically. Unmatched payments go to a suspense list for the bursar to assign.
- **M-Pesa STK Push:** the parent taps Pay in the portal and confirms on their phone.
- Bank deposits, cheques and cash recorded by the bursar or clerk.
- Payments split across vote heads by a priority order the school sets.

**Receipts**

- Issued automatically for M-Pesa and manually for other payments.
- Printable on 80mm thermal printers and A4, and sent as a PDF over WhatsApp, or both. A short SMS confirmation always goes out.
- Sequential, tamper-proof numbering. A receipt is never edited or deleted. A mistake is corrected by a reversal that records the reason, who did it and when, and the director is notified.

**Reports and dashboards**

- Collected vs expected per term, per class, per vote head.
- Defaulters list with one-tap fee reminders to their parents.
- Pledges: a parent commits to pay an amount by a date; the system reminds them and tracks whether it was kept.
- Fee statements per student, daily collection report, and export to Excel for the auditor.

**Later:** expense tracking, fee financing through a lending partner, and HR and payroll.

## Academics and analytics

Teachers enter marks once; the system produces report cards and the analysis for teachers, leadership and parents from the same data.

**Grading (configured per level, never hard-coded)**

- CBC performance levels for primary and junior school (EE, ME, AE, BE and their sub-levels), with competency and values comments.
- Senior school pathways with per-student subject combinations.
- 8-4-4 grading (A to E, points, mean grade) for Forms 3–4 until the last cohort leaves.
- Assessment types per school: CATs, mid-term, end-term, projects, with weights that make up the term result.

**Mark entry**

- On phone or computer, one class and subject at a time, with an Excel upload option.
- Locked once the class teacher signs off; changes after that need the principal and are logged.

**Report cards**

- Templates the school chooses and brands, printed in bulk or as PDFs.
- Teacher and principal comments, with suggested comments to speed up writing.
- Fee balance and next term's opening date on the report, if the school wants them.

**Analytics**

- Per student: trend across terms, strengths and weak areas, position or level in class.
- Per class and stream: averages, spread of performance levels, best and weakest subjects, stream comparisons.
- Per subject and teacher: performance across classes and terms.
- School-wide: performance by level, year on year, and most improved students.
- Shown as line graphs, bar charts and pie charts, all exportable.

**National exams.** KJSEA (Grade 9) and KCSE results recorded and analysed by year.

**Later:** timetabling, homework and lesson plans.

## Parent portal

A parent signs in once with their phone number and sees every child they are linked to, in every school on the platform, from one dashboard.

**Sign-in.** Phone number plus a one-time SMS code; no password to forget. A mobile web app first, which parents can add to their home screen; native Android and iOS apps later.

**One family account, many schools**

- A parent is one platform-level identity, keyed on their verified phone number.
- Each school links its students to that identity when it records the guardian's number. The first time a new school links a child, the parent confirms with an SMS code before that child appears.
- The top of the dashboard is a child switcher, like switching Instagram accounts: a photo and name per child, with the school's name underneath. An **All children** view shows the family's total fee balance and anything needing attention.
- Privacy: each school sees only its own students and their guardians. A school never learns that the parent has children in other schools.

**What a parent sees per child**

- Fees: balance, invoices, every receipt (downloadable), payment history, and a Pay button using M-Pesa STK Push.
- Academics: report cards, and the same analytics teachers see for that child — trends across terms, strengths and weak subjects, and how the child compares with the class average. Parents can switch between graphs and filter by subject and term.
- Boarding: leave-out history, sick bay visits (summary only), pocket money balance and top-up.
- Notices from the school, with read receipts for the school.

What a parent can see is limited by the per-guardian settings in the student record (for example, a sponsor sees fees only).

## Messaging: SMS and WhatsApp

Each school sends SMS and WhatsApp from one prepaid wallet that Arend Studio sells, at a markup on Arend Studio's bulk rates.

**Wallet**

- The school tops up by M-Pesa; each message deducts its cost. The balance, usage per month and cost per campaign are always visible.
- A low-balance alert to the director and bursar. When the wallet is empty, sending stops except for messages the school marks critical.
- Arend Studio sets the price per SMS and per WhatsApp message per school, so starter bundles and volume discounts are settings.

**Channels**

- SMS through a licensed bulk provider, with the school's own branded sender ID (for example, the school's short name).
- WhatsApp Business API with pre-approved templates for receipts, report links, notices and alerts. Falls back to SMS if the parent has no WhatsApp.
- Every message in the parent's chosen language: English or Kiswahili.

**What gets sent**

| Trigger | Message | Default channel |
| --- | --- | --- |
| Payment received | Confirmation with amount and new balance | SMS, receipt PDF on WhatsApp |
| Fee reminder | Balance and due date | SMS |
| Report card released | Short summary and a secure link to the full report | SMS or WhatsApp |
| Leave-out exit and return | Child left at time, with whom; child returned | SMS |
| Absent from class | Child marked absent today | SMS |
| Notices | Any message from the school to a class, level or whole school | Chosen per message |

Report cards are sent as a link, not as text, because a full report runs to five or more SMS units. The link opens the report in the parent portal.

## Boarding

Boarding is where this system leads the market: every movement, shilling and sick bay visit of a boarder is recorded, and parents are told as it happens.

**Leave-out (exeat)**

_[Diagram in the online doc: leave-out flow · director-controlled approval, SMS on exit and return]_

The director decides which staff may approve leave-outs and can withdraw that permission at any time. The director sees who is out of school right now, who approved each leave-out, and who is overdue back.

- A request records the reason, dates, and who is collecting the child. Only a guardian marked **authorised to collect**, or a person the parent approves by SMS reply, can be named.
- The gate pass carries the student's photo, so the guard can check the right child is leaving.
- A student not back by the return time raises an alert to the boarding master and director.

**Dormitories.** Allocation by dormitory and bed, capacity per dormitory, evening roll call on a phone, and a missing-student alert.

**Pocket money and tuck shop.** Parents top up by M-Pesa into the child's pocket money account. The tuck shop or matron records each spend, and the balance shows in the parent portal. Daily spending limits per student, set by the school or parent.

**Sick bay.** Visits with complaint, treatment and medicine given; referral to hospital with an SMS to the parent. Allergies and chronic conditions flagged. Only sick bay staff and leadership see medical details; parents see a summary.

**Visiting days.** Dates on the school calendar, with reminders to parents. A visitor register at the gate.

## Inventory and stores

The storekeeper records every item in and out, so the director can see stock levels and what each meal costs to serve.

**Stores and items.** Several stores per school (food store, uniform store, general store, stationery), each with items, units and reorder levels. Stock received from a supplier with quantity, cost and delivery note number.

**Food stores**

- Issues to the kitchen recorded per meal (breakfast, lunch, supper) with the number of students served.
- Cost per meal and per student, and consumption trends that flag waste or unusual usage.
- Low-stock alerts before the store runs out.

**Uniforms**

- Stock by item and size.
- Issued to a named student; the item is charged to their fee account automatically, or marked as paid.
- Shows what each student has been issued, to stop double issue.

**Controls.** Monthly stock-take: the storekeeper enters physical counts, and the system shows differences against the records for the director to review. Every adjustment needs a reason and is logged.

**Later:** purchase orders and supplier management, library books, and school assets (furniture, computers, buses).

## Attendance, ID cards and compliance

**Attendance.** Class teachers mark students present, absent or late on a phone in under a minute per class. An absence sends the parent an SMS automatically. Staff attendance is recorded the same way. Attendance trends appear on the student's profile and the director's dashboard.

**Student ID cards.** Printed from the system with photo, admission number and a QR code. The same QR code is used at the gate, the tuck shop and, later, the library.

**Kenyan compliance**

- **NEMIS:** UPI numbers stored on each student, with an export in the format the sub-county education office asks for.
- **National exams:** KJSEA and KCSE results stored per cohort.
- **Curriculum changes:** handled through settings (see Design principles), including the period when 8-4-4 and CBC classes run side by side.

**Data protection (Data Protection Act, 2019)**

- The school is the data controller; Arend Studio is the data processor. A data processing agreement is signed with every school.
- Arend Studio registers with the Office of the Data Protection Commissioner.
- Data hosted in or near Kenya, encrypted in transit and at rest, with daily backups.
- Medical and other sensitive data visible only to roles that need it. Every view or change of sensitive data is logged.
- Parents can ask for their child's data, and the school can export it.

## Technical blueprint for Claude Code

The system is one web application serving every school from a single codebase and database, with each school's data walled off at the database level.

_[Diagram in the online doc: system architecture · three front ends, one server, one database, three outside services]_

M-Pesa payments flow both ways: the app requests STK pushes, and Safaricom calls back with confirmed payments.

**Recommended stack (team to confirm before build)**

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js with TypeScript | One codebase for staff app, parent portal and API; well supported by Claude Code |
| Database | PostgreSQL with row-level security | Per-school walls enforced by the database, not just the code |
| Background jobs | A job queue for messages, invoices and reports | Bulk sends and report generation never block the screen |
| Payments | Safaricom Daraja (C2B Paybill, STK Push) | Direct M-Pesa integration |
| Messaging | Licensed Kenyan bulk SMS provider; WhatsApp Cloud API | Resold through the school wallet |
| PDFs | Server-side PDF generation | Receipts, report cards, gate passes, statements |

**Rules every piece of code follows**

1. Every table that holds school data has a `school_id`, and every query is scoped to it. Row-level security blocks anything that slips through.
2. Parents are platform-level users linked to students through a guardian link table; that link is the only way a parent reaches school data.
3. Money is stored in cents as integers. Payments, receipts and reversals are append-only tables; nothing in them is updated or deleted.
4. Grading schemes, levels, subjects, fee items and report templates are configuration records, never constants in code.
5. An audit log records who did what and when for every money, marks, leave-out and permissions action.
6. Permissions are checked on the server for every action, never just hidden in the interface.

**Core data model**

- **Platform:** schools, users, parent accounts, messaging wallets and transactions, sender IDs.
- **Structure:** academic years, terms, levels, classes, streams, houses, dormitories, subjects, grading schemes.
- **People:** students, guardians, guardian links (with visibility and collection rights), staff, roles, permissions.
- **Finance:** fee items, vote heads, fee structures, invoices, payments, allocations, receipts, reversals, discounts, bursaries, pledges, suspense payments.
- **Academics:** assessments, marks, report cards, comments, national exam results, attendance.
- **Boarding:** leave-out requests, approvals, gate passes, gate events, dormitory allocations, pocket money accounts and transactions, sick bay visits, visitors.
- **Stores:** stores, items, stock movements, meal issues, uniform issues, stock-takes.
- **Messaging:** templates, messages, delivery statuses.

**Working with Claude Code**

- Keep this spec in the repository, and a CLAUDE.md file with the stack, the six rules above, folder layout, naming conventions and how to run tests.
- Build one module at a time in the roadmap order. Each module starts with its data model and tests before screens.
- Automated tests are required for money (allocations, reversals, balances), permissions and school walls. A test proves school A can never read school B's data.
- Use a staging copy loaded with the pilot school's real data to test each phase before release.

## Roadmap and pilot timeline

Fees, receipts, messaging and the parent fee view go live on the first day of Term 1; boarding, stores and report cards roll out during Term 1, in time for half-term leave-outs and end-of-term reports.

_[Diagram in the online doc: pilot roadmap · four phases, three gates]_

**Start now, in parallel with the build** (these depend on third parties and take weeks):

- [ ] Apply for the pilot school's branded SMS sender ID with the networks.
- [ ] Get the school's M-Pesa Paybill linked to Daraja and approved for live use.
- [ ] Verify the WhatsApp Business account and submit message templates for approval.
- [ ] Register Arend Studio with the Office of the Data Protection Commissioner and draft the data processing agreement.
- [ ] Confirm the licensing position for reselling bulk SMS.
- [ ] Send the school the Excel data template.

**December onboarding**

1. The school returns the completed template: students, guardians, classes, dormitories, fee structures and opening balances.
2. Arend Studio cleans and imports it, and the school checks a sample of records and balances.
3. Pilot data fully loaded by Dec 18, 2026.
4. Staff training by role in the first week of January: bursar and clerk first, then teachers, boarding staff, storekeeper and gate guards.
5. Parents receive an SMS inviting them to the portal on opening day.

## Business model and pricing

Arend Studio earns a per-learner subscription, a one-off setup fee, and a margin on every message and transaction; exact prices are set after the pilot.

| Revenue line | How it works |
| --- | --- |
| Subscription | Per learner per term, the model Kenyan schools already use. Priced in modules: core (records, fees, messaging, portal), academics, boarding, stores. |
| Setup fee | One-off: configuration, data import and staff training. |
| Messaging | Prepaid SMS and WhatsApp wallet, resold at a margin over Arend Studio's bulk rates. |
| Pocket money | A small fee per top-up, or included in the boarding module. |
| Later | Fee financing referrals through a lending partner. |

**Market reference.** Mzizi charges KES 250 per learner per term for its finance or academic pack and KES 350 for both, plus a setup fee of KES 34,800–63,800 ([Mzizi brochure](https://blog.mzizi.co.ke/)). Pricing the core plus academics just under KES 350 makes Arend Studio competitive, with messaging and boarding as the margin.

**Onboarding offer for new schools.** A free branded sender ID and a starter bundle of SMS lowers the barrier to switching; SkaasSchools already offers this ([SkaasSchools](https://ecobiz.co.ke/skaasschools)).

**Pilot school terms** are agreed separately: what the school pays during the pilot, from when, and its consent to be a named case study.

## Open questions

**For the pilot school**

- [ ] Which levels and how many students, boarders and staff?
- [ ] Exact opening date of Term 1, 2027, and the half-term dates?
- [ ] Current fee structure, vote heads and how fees are paid today (Paybill number, banks)?
- [ ] Where student, fee and marks records live today (Excel, paper, another system)?
- [ ] Receipt printer: thermal or A4, and is one already in place?
- [ ] Who handles leave-outs today, and who should the director name as approvers?
- [ ] Does the school run a tuck shop, and does it want pocket money in the system?
- [ ] The sender ID name the school wants on its SMS.

**For the Arend Studio team**

- [ ] Logo and brand identity for Kiota (name and kiota.app domain decided).
- [ ] Final stack and hosting choice.
- [ ] Bulk SMS provider and the licensing position for reselling.
- [ ] Pilot pricing and the case study agreement.
- [ ] Who handles school support and training after go-live.

## Sources

- [Mzizi School ERP brochure](https://blog.mzizi.co.ke/)
- [SkaasSchools](https://ecobiz.co.ke/skaasschools)
- [Zeraki Finance](https://www.zeraki.app/zeraki-finance)
- [Elimu SMS on Capterra](https://www.capterra.co.uk/software/1109566/Elimu-SMS)
- [OpenEduCat: School Management System for Kenya](https://openeducat.org/solutions/school-management-system-kenya/)
