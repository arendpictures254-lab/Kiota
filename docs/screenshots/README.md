# Responsive design: before and after

Every main screen at four widths, before and after the responsive work (November 2026).
Files are named `<screen>-<width>.jpg`:

| Width   | Stands for                  |
| ------- | --------------------------- |
| 390 px  | A phone (390×844)           |
| 768 px  | A tablet (768×1024)         |
| 1366 px | A common laptop (1366×768)  |
| 1920 px | A large display (1920×1080) |

`before/` was taken before the work, `after/` after it. Rebuild with
`npm run screenshots -- docs/screenshots/after` (dev server and seeded database running). The same
screens are checked for sideways scrolling, also at 320 px, by `e2e/responsive.spec.ts`. The rules
are in CLAUDE.md, "Responsive design".

## What changed

### Everywhere

- **New app shell.** Phones: a top bar (school name, user menu) and a bottom tab bar with the
  role's 4–5 main sections; more sections go under "More". From 1024 px: a left sidebar with the
  school's crest and name, the user menu (account, switch school, parent view, sign out) and the
  sections. Sections come from permissions, so a bursar sees Fees first and a teacher "My
  students".
- **Content widths.** Dashboards and lists use up to 1440 px; forms ~720 px; reading pages
  (receipts, notices, one leave-out) ~760 px. Before, every screen was a 480 px phone column in
  the middle of the display.
- **Card grids.** Lists of students, payments, M-Pesa transactions, staff, leave-outs, messages,
  setup sections and admin lists show 1 column on a phone, 2 on a tablet or laptop, 3 on a large
  display.
- **Tables.** One `DataTable`: from 1024 px a full table with a sticky header, sortable columns
  and set widths; below, stacked rows showing 2–3 fields. Used for fee reports (by vote head, by
  class), wallet usage per month and leave-out reports (per class and reason, which used to
  scroll sideways).
- **Fluid type** (`text-display`, `text-title`, `text-section` with `clamp()`), **44 px touch
  targets** on touch screens, buttons that fit their label from 640 px instead of stretching
  across a laptop.
- **No sideways scrolling** on any main screen from 320 px up. Two found and fixed: fee setup at
  1366 px (the order buttons) and the message history at 320 px (long links in SMS text).

### Screens

- **Sign-in:** split screen from 1024 px (brand panel with three points, form on the right);
  phone unchanged apart from the language switch in the top bar.
- **Director dashboard ("control room"):** key numbers at the top (collected vs expected this
  term, students, staff, students out on leave, wallet balance), then recent payments, leave-outs
  waiting for approval and recent notices side by side. Bursar and teacher dashboards show only
  the parts their permissions allow.
- **Students:** add and import side by side; search and button on one line, filters in a row;
  2–3 column list. **Student profile:** the cards flow into two columns from 1280 px.
- **Fees:** hub, payments, M-Pesa in grids; **fee setup** in two columns; **fee reports** with
  tables side by side, filters in one row and defaulters in two columns.
- **Messages, wallet, message history, leave-outs and leave-out reports:** grids and tables as
  above; forms (send a notice, invite parents, request a leave-out, half term) at form width.
- **Arend admin:** same shell with the admin sections.
- **Parent portal:** sidebar from 1024 px listing each child with class and full school name;
  bottom tab bar on phones. One child: a slim header (photo, name, class, school); several:
  compact chips with the full school name, never cut off. Child page from 1024 px: the child,
  "Due now" and Pay on the left; fees by vote head, the latest notices and the last three
  receipts on the right. Balance, Pay, Fees and Notices are above the fold at 1366×768 and
  390×844. Only overdue amounts are red; the total balance is in ink. Home and fees use two
  columns on a laptop; notices use the reading width.
- **Gate:** still a phone layout, centred and enlarged on bigger screens.
- **Unchanged on purpose:** printed receipts, statements and leave-out passes (print layouts),
  and the public website (already responsive).
