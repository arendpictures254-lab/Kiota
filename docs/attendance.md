# Attendance, photos and ID cards

## Class attendance

- **Who takes a register:** the stream's class teacher (`attendance.take`, set under School
  setup → Classes), or the Principal and Director (`attendance.manage`) for any stream.
- **Taking it:** Attendance → "Take morning register". Everyone starts as Present; tap a name to
  cycle Absent → Late → Present; one "Submit register" button. Students on an approved leave-out
  (out, or approved for that time) show as **On leave** and can't be marked.
- **Register times** (Attendance → Register times and alerts): Morning opens 07:30, cut-off
  08:30; Afternoon 14:00, cut-off 14:30 by default. Registers not submitted by the cut-off show
  on the Principal's and Director's dashboards, on school days.
- **The school week** (same page): the days registers are expected (Monday to Friday by
  default), and levels with Saturday classes (e.g. senior school only). Late-register alerts,
  staff attendance's school days and the lates-by-weekday report follow it.
- **Corrections:** the same day by whoever took it; on a later day only with `attendance.manage`.
  Every submit and correction is in the audit log (`attendance.submit`, `attendance.correct`).

## Who is told about an absence

| Student     | What happens                                                                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Day scholar | An SMS to the parents after the school's delay (30 minutes by default). Corrected to present or late before then: nothing is sent. Can be switched off.                                                                                                   |
| Boarder     | The boarding master and matron (`boarding.alerts`) and the Director get an in-app alert. They check and answer **Found** or **Not found**. Not found sends the parents an urgent (critical) SMS. The school can also SMS boarders' parents straight away. |

SMS go through the normal outbox (wallet, the parent's language, quiet hours; "not found" is
critical). The worker in the app server sends due absence SMS every few seconds
(`processAbsenceAlerts`).

## Staff attendance

Everyone taps **I'm in** and **I'm leaving** on the dashboard (their own day only: the database
refuses anything else). The Principal, or anyone given `staff_attendance.manage`, marks staff
present, absent or on leave, and sees daily and monthly reports (Attendance → Staff attendance).
No location is recorded.

## Reports

Attendance → Reports: whole school and per stream (% present or late of registers taken; on
leave doesn't count), students absent 3 days or more, often late, lates by weekday, and an
Excel export. Each student's profile shows their % this term (the last four weeks when no term is
running), days absent, lates and a calendar. Parents see the same in the portal when the school
switches on "Attendance in the parent portal": this term's dates come through the parent-safe
`app_parent_current_term()` function (from their own confirmed link), with the last four weeks
when no term is running.

## Student photos

- **One student:** the profile's Photo card: "Take a photo" opens the phone camera, or choose a
  file. Big phone photos are shrunk in the browser before sending.
- **Many:** Students → Photos. Choose a folder, several photos or a .zip; each file named by
  admission number (`BA-2025-002.jpg`, `BA_2025_002.png` or `ba2025002.jpg` for BA/2025/002).
  The preview lists matches, files that match nobody and students still without a photo before
  anything is saved; photos are then sent one at a time and the server checks each name again.
- Kiota keeps every original (`photo_original_key`) and crops a 4:5 portrait (480 × 600) for ID
  cards, gate passes and the gate phone.

## Student ID cards

- **Printing** (`idcards.print`: Director, Principal, School secretary): Students → ID cards,
  choose a class or stream. The preview shows each card front and back; **A4 sheets** (8 cards
  per page with crop marks, then the backs mirrored for long-edge duplex) or **For a card
  printer** (CR80, 85.6 × 54 mm, one page per side). Printing issues a card to anyone without one.
- **The QR code** holds only a signed token, `KC1.<school>.<card>.<nonce>.<signature>` (Ed25519,
  the school's key, a different format from gate passes `KP1…`). It names a card, not a purpose,
  so the tuck shop and library can use it later.
- **At the gate** a scanned ID card shows the student's photo, name and class, and
  **No valid leave-out** unless they have an approved pass (then the pass is checked as usual).
  Offline, the phone checks the card's signature with the school's key and finds the student in
  its downloaded copy of the school's cards (`app_gate_cards()`: name, class and boarder/day,
  never more); the photo shows when the student has a pass on the phone. With no cached pass it
  says "No valid leave-out", the same as online. A card the phone doesn't know yet: "Can't check
  offline".
- **Lost card:** the profile's ID card section → Reissue. The old card is revoked at once (its
  QR then shows "This card was replaced").

## Try it

```bash
npm run db:seed          # two weeks of history at Bahari, today's registers, photos
npm run dev
```

- Grace Wanjiru (0711 000 003, choose Staff): today's Grade 7 East morning register is not taken.
- Joseph Mwangi, Principal (0711 000 006): the attendance glance, late registers, reports, staff.
- Mercy Chebet, boarding master (0711 000 005): one absent boarder to check.
- Lucy Wambui, School secretary (0711 000 008): Students → Photos and ID cards.
- Wanjiku Kamau, parent (0744 000 001): Brian → Attendance.
