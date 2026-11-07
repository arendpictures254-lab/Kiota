# Academics: grading, marks, results and report cards

This module covers everything up to **released** report cards. Parent delivery (portal and SMS)
and performance graphs come next.

## Who does what

| Person              | Permissions                                                  | Does                                                       |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Director of Studies | `academics.setup`, `results.approve`, `reports.print`        | Sets up assessments and teaching, approves and releases    |
| Principal           | the same, plus `marks.unlock`                                | Approves; the only one who can change marks after sign-off |
| Subject teacher     | `marks.enter` (only for their teaching assignments)          | Enters and submits marks                                   |
| Class teacher       | `marks.enter`, `marks.signoff`, `reports.print` (own stream) | Comments, competency ratings, signs the stream off, prints |
| Director            | everything                                                   |                                                            |

Parents see nothing yet.

## Configuration (never constants in code)

- **Grading schemes** are copied to every school by `kiota_academic_defaults()` and are edited
  under Academics → Grading and report cards:
  - CBC rubric (EE 4, ME 3, AE 2, BE 1) for pre-primary and primary. The mark ranges (75/50/25)
    are only a starting point: _confirm against current KNEC guidance_.
  - Junior School, the KNEC 8-level scale (EE1 90–100 … BE2 1–10): _confirm against current
    KNEC guidance_.
  - Senior School: the same 8 levels, _to be confirmed when KNEC publishes the senior scale_.
  - KCSE (8-4-4): A (12) … E (1) with editable mark ranges.
- A level uses its own chosen scheme, or the scheme made for its key. **Positions** default to
  off for CBC schemes and on for KCSE; a level can override.
- **Assessments** per term and level: name, maximum marks, weight. A subject may have its own
  weight for an assessment (0 = doesn't count). Saving is refused unless every subject's weights
  add up to 100.
- **Teaching assignments** decide who enters marks: one teacher per subject per stream.
- **Core competencies and values** (7 and 8) are rated by the class teacher on the 4-level rubric
  (the scheme flagged `for_competencies`).
- **Comment bank** per level, by band (EE, ME… or A, B…; EE also matches EE1/EE2), for class
  teachers and the principal.
- **Report settings**: template (classic or modern), show the fee balance, show next term's date.

## The maths (src/lib/academics/grading.ts)

Integers throughout: marks in tenths, percentages in tenths of a percent, mean points in
hundredths.

- Subject term result = weighted average of the assessments as percentages. **Absent and Exempt
  are left out** and the other weights scaled up. They are never counted as zero. A subject that
  is all absent or exempt has no result and is left out of the student's mean.
- A percentage gets the highest level whose minimum it reaches, after rounding half up to a
  whole mark (89.5 → 90 → EE1; 89.4 → EE2). A scheme can switch rounding off.
- Total = sum of subject scores; mean score = total / subjects; mean points = average of the
  subject points; **mean grade = mean points rounded half up** (KCSE style: 7.5 → 8 → B-).
- Positions: by mean points, then mean score; ties share a place (1, 2, 2, 4). Class positions
  use every stream of the class (through `app_class_marks`, ids and numbers only).

## Mark entry

- `/dashboard/academics` lists a teacher's own sheets (stream × subject).
- **Desktop (≥ 1024 px)**: a grid with one column per assessment. Enter moves down, Tab moves
  right, and pasting a column (or block) from Excel fills down. **Phones**: one assessment at a
  time, one student per row, a large number pad and Abs/Ex buttons. Both autosave.
- Type a mark (one decimal place at most), `A` for absent and `X` for exempt. Marks above the
  maximum are refused in the browser, in the service and by a database trigger.
- **Excel**: download the template for an assessment, fill the Mark column and upload it. All or
  nothing.
- The teacher **submits** each assessment once every student has a mark, A or X. The class
  teacher sees which subjects are complete.

## Sign-off and release

`draft → signed_off → approved → released` (`stream_results`).

1. The class teacher signs the stream off once every assigned subject is submitted. **Marks
   lock.**
2. After that, only `marks.unlock` (the Principal) can change a mark, with a reason. Each change
   is in the audit log (`marks.change_locked`) with the old and new mark. Row-level security
   blocks everyone else, even writing straight to the database.
3. The Principal or Director of Studies approves, or sends it back with a reason (back to draft).
4. Release issues a report card per student, each with a random verification code. Released
   results are final: a trigger refuses any change, and only `results.approve` can approve or
   release.

## Report cards

- A4 PDF (pdfkit), one page per student. A stream prints as one PDF in admission-number order
  (`/dashboard/academics/print/<stream>?term=…`). An HTML preview is on each student.
- School name and crest first, "Powered by kiota" small. Student details and photo, subjects
  with score, level/grade, points, remark and teacher initials, totals and means, positions (if
  on), competencies and values, attendance this term, both comments, fee balance and next term
  (if on), signature lines and a stamp area.
- Before release: marked "Draft: not released", no QR code.
- **Verification**: the QR code opens `kiota.app/v/<code>`. It shows only the school, the
  student's name, the term and the release date (`app_verify_report_card`). Unknown codes are a
  real 404 (src/proxy.ts).
- Fee balances and attendance come through `app_report_fee_balances` and
  `app_report_attendance`: a class teacher printing reports never reads the ledger.

## School walls

Every academics table has `school_id` and row-level security. Subject teachers never read
student records: their mark sheets get names and admission numbers from
`app_mark_sheet_students`, only for streams they teach. Tests:
`src/lib/academics/academics.db.test.ts` (including School B never seeing School A's marks).

## Trying it (seeded Bahari Academy, Term 3 2026)

| Who                           | Phone        | Try                                                                |
| ----------------------------- | ------------ | ------------------------------------------------------------------ |
| Grace Wanjiru, class teacher  | 0711 000 003 | Choose Staff. English in Grade 7 West: an empty sheet to fill      |
| Ruth Njoroge, class teacher   | 0711 000 010 | Grade 8 East: signed off, comments on 8 students                   |
| Kevin Odhiambo, Form 4        | 0711 000 014 | Form 4 Blue (8-4-4, positions on): Physics and Business unfinished |
| Samuel Mutua, Dir. of Studies | 0711 000 013 | Approve Grade 8 East; set-up screens                               |
| Joseph Mwangi, Principal      | 0711 000 006 | Grade 7 East: released, print the PDF; scan a QR code              |

## Not done yet

- Report card templates matched to a school's own sample (the option is noted on the settings
  screen).
- Parent delivery, analytics and graphs, national exam results (next prompts).
- KCSE "best 7 subjects" and cluster rules: the mean grade uses every subject taken. Confirm with
  the pilot school.
