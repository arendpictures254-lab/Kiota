/**
 * Mark entry. A subject teacher enters marks only for their own teaching assignments: one
 * stream, one subject, one assessment at a time (the grid shows the term's assessments side by
 * side). Marks autosave; Absent and Exempt are statuses, never zero; marks above the maximum are
 * refused (here and by a database trigger). Row-level security repeats every rule: a teacher's
 * write to someone else's subject is blocked by the database too.
 *
 * Once the class teacher signs the stream off, its marks lock. Only marks.unlock (the
 * Principal) may change them then, with a reason, and each change is audited with before/after.
 */
import ExcelJS from "exceljs";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { type MarkValue, markText, parseMark, weightFor } from "./grading";
import {
  assertSeeAcademics,
  assessmentsFor,
  myMembershipId,
  schemeOf,
  schemesIn,
  termsIn,
} from "./setup";

export type SheetStudent = {
  id: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
};

export async function sheetStudents(tx: Tx, streamId: string, subjectId: string | null) {
  const rows = await tx.$queryRaw<
    { id: string; first_name: string; last_name: string; admission_number: string }[]
  >`SELECT * FROM app_mark_sheet_students(${streamId}::uuid, ${subjectId}::uuid)`;
  return rows.map((r): SheetStudent => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    admissionNumber: r.admission_number,
  }));
}

export async function streamLevel(tx: Tx, schoolId: string, streamId: string) {
  const s = await tx.stream.findUnique({
    where: { schoolId, id: streamId },
    include: {
      class: { include: { level: true } },
      classTeacher: { select: { id: true, displayName: true } },
    },
  });
  if (!s) throw new ValidationError("Stream not found.");
  return s;
}

/** Locked: the stream's results for the term are past draft. */
export async function streamStatus(tx: Tx, schoolId: string, termId: string, streamId: string) {
  const r = await tx.streamResult.findUnique({
    where: { schoolId, termId_streamId: { termId, streamId } },
  });
  return r?.status ?? "draft";
}

// ---------------------------------------------------------------------------
// What a teacher sees
// ---------------------------------------------------------------------------

/** The teacher's own mark sheets for a term, with how far each is. */
export async function myMarkSheets({ db }: Deps, actor: Actor, termId?: string) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const terms = await termsIn(tx, actor.schoolId);
    const term = terms.find((t) => t.id === termId) ?? null;
    const me = await myMembershipId(tx, actor);
    if (!term || !me) return [];
    const assignments = await tx.teachingAssignment.findMany({
      where: { schoolId: actor.schoolId, membershipId: me },
      include: {
        stream: { include: { class: { include: { level: true } } } },
        subject: { select: { id: true, name: true } },
      },
    });
    const out = [];
    for (const a of assignments) {
      const assessments = (
        await assessmentsFor(tx, actor.schoolId, term.id, a.stream.class.levelId)
      ).filter((x) => weightFor(x, a.subjectId) > 0);
      const [students, marks, submissions, status] = await Promise.all([
        sheetStudents(tx, a.streamId, a.subjectId),
        tx.mark.groupBy({
          by: ["assessmentId"],
          where: {
            schoolId: actor.schoolId,
            streamId: a.streamId,
            subjectId: a.subjectId,
            assessmentId: { in: assessments.map((x) => x.id) },
          },
          _count: { _all: true },
        }),
        tx.markSubmission.findMany({
          where: {
            schoolId: actor.schoolId,
            streamId: a.streamId,
            subjectId: a.subjectId,
            assessmentId: { in: assessments.map((x) => x.id) },
          },
          select: { assessmentId: true },
        }),
        streamStatus(tx, actor.schoolId, term.id, a.streamId),
      ]);
      out.push({
        streamId: a.streamId,
        subjectId: a.subjectId,
        stream: `${a.stream.class.name} ${a.stream.name}`,
        subject: a.subject.name,
        students: students.length,
        status,
        assessments: assessments.map((x) => ({
          id: x.id,
          name: x.name,
          entered: marks.find((m) => m.assessmentId === x.id)?._count._all ?? 0,
          submitted: submissions.some((s) => s.assessmentId === x.id),
        })),
        sortKey: `${a.stream.class.level.sortOrder}-${a.stream.class.position}-${a.stream.name}-${a.subject.name}`,
      });
    }
    return out.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  });
}

/** One mark sheet: the stream's students, the subject's assessments, the marks so far. */
export async function markSheet(
  { db }: Deps,
  actor: Actor,
  q: { termId: string; streamId: string; subjectId: string },
) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const stream = await streamLevel(tx, actor.schoolId, q.streamId);
    const subject = await tx.subject.findUnique({
      where: { schoolId: actor.schoolId, id: q.subjectId },
    });
    if (!subject || subject.levelId !== stream.class.levelId) return null;
    const terms = await termsIn(tx, actor.schoolId);
    const term = terms.find((t) => t.id === q.termId);
    if (!term) return null;
    const me = await myMembershipId(tx, actor);
    const assignment = await tx.teachingAssignment.findUnique({
      where: {
        schoolId: actor.schoolId,
        streamId_subjectId: { streamId: q.streamId, subjectId: q.subjectId },
      },
      include: { teacher: { select: { id: true, displayName: true } } },
    });
    const status = await streamStatus(tx, actor.schoolId, term.id, q.streamId);
    const locked = status !== "draft";
    const mine = !!assignment && assignment.membershipId === me;
    const canEdit = locked
      ? actor.permissions.has("marks.unlock") && status !== "released"
      : actor.permissions.has("marks.enter") && mine;
    const students = await sheetStudents(tx, q.streamId, q.subjectId);
    if (!students.length && !mine && !actor.permissions.has("results.approve")) {
      // Nothing visible: not this person's stream.
      const visible = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT app_can_see_marks(${q.streamId}::uuid) AS ok`;
      if (!visible[0]?.ok) throw new ForbiddenError("marks.enter");
    }
    const assessments = (await assessmentsFor(tx, actor.schoolId, term.id, stream.class.levelId))
      .map((a) => ({
        id: a.id,
        name: a.name,
        maxMarks: a.maxMarks,
        weight: weightFor(a, subject.id),
      }))
      .filter((a) => a.weight > 0);
    const [marks, submissions, schemes] = await Promise.all([
      tx.mark.findMany({
        where: {
          schoolId: actor.schoolId,
          streamId: q.streamId,
          subjectId: q.subjectId,
          assessmentId: { in: assessments.map((a) => a.id) },
        },
        select: { studentId: true, assessmentId: true, status: true, scoreTenths: true },
      }),
      tx.markSubmission.findMany({
        where: { schoolId: actor.schoolId, streamId: q.streamId, subjectId: q.subjectId },
        select: { assessmentId: true, submittedAt: true },
      }),
      schemesIn(tx, actor.schoolId),
    ]);
    const scheme = schemeOf(schemes, stream.class.level);
    return {
      term,
      stream: {
        id: stream.id,
        name: `${stream.class.name} ${stream.name}`,
        levelName: stream.class.level.name,
      },
      subject: { id: subject.id, name: subject.name },
      teacher: assignment?.teacher.displayName ?? null,
      status,
      locked,
      canEdit,
      mine,
      scheme: scheme
        ? { roundMarks: scheme.roundMarks, levels: scheme.levels }
        : { roundMarks: true, levels: [] },
      assessments: assessments.map((a) => ({
        ...a,
        submitted: submissions.some((s) => s.assessmentId === a.id),
      })),
      students,
      /** `${studentId}:${assessmentId}` → typed form ("73.5", "A", "X"). */
      marks: Object.fromEntries(
        marks.map((m) => [
          `${m.studentId}:${m.assessmentId}`,
          markText({ status: m.status as MarkValue["status"], scoreTenths: m.scoreTenths }),
        ]),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export type MarkEntry = { studentId: string; assessmentId: string; value: string };
export type SaveResult = {
  saved: number;
  errors: { studentId: string; assessmentId: string; message: string }[];
};

/**
 * Save typed marks (autosave sends the cells that changed). Valid cells are saved; invalid ones
 * come back with a message. After sign-off: marks.unlock only, with a reason, each change audited.
 */
export async function saveMarks(
  { db }: Deps,
  actor: Actor,
  input: {
    termId: string;
    streamId: string;
    subjectId: string;
    entries: MarkEntry[];
    reason?: unknown;
  },
): Promise<SaveResult> {
  assertSeeAcademics(actor.permissions);
  if (!actor.permissions.has("marks.enter") && !actor.permissions.has("marks.unlock"))
    throw new ForbiddenError("marks.enter");
  if (input.entries.length > 2000) throw new ValidationError("Too many marks at once.");
  return withContext(db, ctxOf(actor), (tx) => saveMarksIn(tx, actor, input), {
    timeoutMs: 30_000,
  });
}

export async function saveMarksIn(
  tx: Tx,
  actor: Actor,
  input: {
    termId: string;
    streamId: string;
    subjectId: string;
    entries: MarkEntry[];
    reason?: unknown;
  },
): Promise<SaveResult> {
  const schoolId = actor.schoolId;
  const stream = await streamLevel(tx, schoolId, input.streamId);
  const subject = await tx.subject.findUnique({ where: { schoolId, id: input.subjectId } });
  if (!subject || subject.levelId !== stream.class.levelId)
    throw new ValidationError("That subject is not taught at this level.");
  const status = await streamStatus(tx, schoolId, input.termId, input.streamId);
  const locked = status !== "draft";
  if (status === "released")
    throw new ValidationError("These results are released: marks can no longer change.");
  const reason = clean(input.reason);
  if (locked) {
    if (!actor.permissions.has("marks.unlock")) {
      throw new ValidationError(
        "The class teacher has signed these marks off. Ask the Principal to change them.",
      );
    }
    if (!reason) throw new ValidationError("Say why the marks change after sign-off.", "reason");
  } else {
    const me = await myMembershipId(tx, actor);
    const assignment = await tx.teachingAssignment.findUnique({
      where: {
        schoolId,
        streamId_subjectId: { streamId: input.streamId, subjectId: input.subjectId },
      },
    });
    if (!actor.permissions.has("marks.enter") || !assignment || assignment.membershipId !== me)
      throw new ForbiddenError("marks.enter");
  }
  const assessments = new Map(
    (await assessmentsFor(tx, schoolId, input.termId, stream.class.levelId))
      .filter((a) => weightFor(a, subject.id) > 0)
      .map((a) => [a.id, a]),
  );
  const students = new Set(
    (await sheetStudents(tx, input.streamId, input.subjectId)).map((s) => s.id),
  );
  const existing = await tx.mark.findMany({
    where: {
      schoolId,
      streamId: input.streamId,
      subjectId: input.subjectId,
      assessmentId: { in: [...assessments.keys()] },
    },
  });
  const byKey = new Map(existing.map((m) => [`${m.studentId}:${m.assessmentId}`, m]));

  const errors: SaveResult["errors"] = [];
  const changes: { studentId: string; assessmentId: string; before: string; after: string }[] = [];
  for (const e of input.entries) {
    const a = assessments.get(e.assessmentId);
    if (!a || !students.has(e.studentId)) {
      errors.push({ ...pick(e), message: "Not on this mark sheet" });
      continue;
    }
    const parsed = parseMark(String(e.value ?? ""), a.maxMarks);
    if (parsed.kind === "error") {
      errors.push({ ...pick(e), message: parsed.message });
      continue;
    }
    const key = `${e.studentId}:${e.assessmentId}`;
    const old = byKey.get(key);
    const before = old
      ? markText({ status: old.status as MarkValue["status"], scoreTenths: old.scoreTenths })
      : "";
    if (parsed.kind === "clear") {
      if (!old) continue;
      await tx.mark.delete({ where: { schoolId, id: old.id } });
      byKey.delete(key);
      changes.push({ ...pick(e), before, after: "" });
      continue;
    }
    const after = markText(parsed.value);
    if (old && before === after) continue;
    const data = {
      status: parsed.value.status,
      scoreTenths: parsed.value.scoreTenths,
      enteredById: actor.userId,
    };
    if (old) await tx.mark.update({ where: { schoolId, id: old.id }, data });
    else
      await tx.mark.create({
        data: {
          schoolId,
          assessmentId: e.assessmentId,
          subjectId: input.subjectId,
          streamId: input.streamId,
          studentId: e.studentId,
          ...data,
        },
      });
    changes.push({ ...pick(e), before, after });
  }

  if (changes.length) {
    if (locked) {
      for (const c of changes)
        await audit(tx, {
          schoolId,
          actorId: actor.userId,
          action: "marks.change_locked",
          targetType: "mark",
          targetId: `${c.studentId}:${c.assessmentId}:${input.subjectId}`,
          before: {
            mark: c.before,
            studentId: c.studentId,
            assessmentId: c.assessmentId,
            subjectId: input.subjectId,
          },
          after: { mark: c.after, reason },
          ip: actor.ip,
        });
    } else {
      await audit(tx, {
        schoolId,
        actorId: actor.userId,
        action: "marks.enter",
        targetType: "mark_sheet",
        targetId: `${input.streamId}:${input.subjectId}`,
        after: { changes: changes.slice(0, 200) },
        ip: actor.ip,
      });
    }
  }
  return { saved: changes.length, errors };
}
const pick = (e: MarkEntry) => ({ studentId: e.studentId, assessmentId: e.assessmentId });

/** The teacher says an assessment's marks are complete for the stream. */
export async function submitMarks(
  { db }: Deps,
  actor: Actor,
  q: { termId: string; streamId: string; subjectId: string; assessmentId: string },
) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const schoolId = actor.schoolId;
    if ((await streamStatus(tx, schoolId, q.termId, q.streamId)) !== "draft")
      throw new ValidationError("Already signed off.");
    const me = await myMembershipId(tx, actor);
    const assignment = await tx.teachingAssignment.findUnique({
      where: { schoolId, streamId_subjectId: { streamId: q.streamId, subjectId: q.subjectId } },
    });
    if (!actor.permissions.has("marks.enter") || !assignment || assignment.membershipId !== me)
      throw new ForbiddenError("marks.enter");
    const students = await sheetStudents(tx, q.streamId, q.subjectId);
    const have = await tx.mark.count({
      where: {
        schoolId,
        streamId: q.streamId,
        subjectId: q.subjectId,
        assessmentId: q.assessmentId,
        studentId: { in: students.map((s) => s.id) },
      },
    });
    const missing = students.length - have;
    if (missing > 0)
      throw new ValidationError(
        `${missing} student${missing === 1 ? " has" : "s have"} no mark yet. Enter a mark, A (absent) or X (exempt).`,
      );
    await tx.markSubmission.upsert({
      where: {
        schoolId,
        assessmentId_subjectId_streamId: {
          assessmentId: q.assessmentId,
          subjectId: q.subjectId,
          streamId: q.streamId,
        },
      },
      create: { schoolId, ...pickSheet(q), submittedById: actor.userId },
      update: {},
    });
    await audit(tx, {
      schoolId,
      actorId: actor.userId,
      action: "marks.submit",
      targetType: "mark_sheet",
      targetId: `${q.streamId}:${q.subjectId}:${q.assessmentId}`,
      ip: actor.ip,
    });
  });
}
const pickSheet = (q: { streamId: string; subjectId: string; assessmentId: string }) => ({
  streamId: q.streamId,
  subjectId: q.subjectId,
  assessmentId: q.assessmentId,
});

// ---------------------------------------------------------------------------
// Excel: template and upload
// ---------------------------------------------------------------------------

/** A filled template for one stream, subject and assessment. */
export async function markTemplate(
  deps: Deps,
  actor: Actor,
  q: { termId: string; streamId: string; subjectId: string; assessmentId: string },
) {
  const sheet = await markSheet(deps, actor, q);
  const a = sheet?.assessments.find((x) => x.id === q.assessmentId);
  if (!sheet || !a) throw new ValidationError("Mark sheet not found.");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kiota";
  const ws = wb.addWorksheet("Marks", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Admission number", key: "adm", width: 18, style: { numFmt: "@" } },
    { header: "Student", key: "name", width: 28 },
    { header: `Mark (out of ${a.maxMarks})`, key: "mark", width: 16 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5F63" } };
  for (const s of sheet.students)
    ws.addRow({
      adm: s.admissionNumber,
      name: `${s.firstName} ${s.lastName}`,
      mark: sheet.marks[`${s.id}:${a.id}`] ?? "",
    });
  const notes = wb.addWorksheet("How to fill");
  notes.getColumn(1).width = 90;
  for (const line of [
    `${sheet.subject.name} · ${sheet.stream.name} · ${a.name} · ${sheet.term.label}`,
    `Type each mark out of ${a.maxMarks} (one decimal place at most, e.g. 27.5).`,
    "Type A for absent and X for exempt. Never 0 for a student who did not sit.",
    "Leave a mark empty to keep what is already in Kiota.",
    "Do not change the admission numbers. Upload the file on the mark sheet in Kiota.",
  ])
    notes.addRow([line]);
  return {
    filename: `${sheet.stream.name} ${sheet.subject.name} ${a.name}.xlsx`.replace(/[^\w .-]+/g, ""),
    bytes: Buffer.from(await wb.xlsx.writeBuffer()),
  };
}

/** Upload a filled template. All or nothing: any problem and nothing is saved. */
export async function uploadMarks(
  { db }: Deps,
  actor: Actor,
  q: { termId: string; streamId: string; subjectId: string; assessmentId: string; bytes: Buffer },
) {
  assertSeeAcademics(actor.permissions);
  if (!q.bytes.length) throw new ValidationError("Choose the filled Excel file.", "file");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(q.bytes as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError("That file is not an Excel (.xlsx) file.", "file");
  }
  const ws = wb.getWorksheet("Marks") ?? wb.worksheets[0];
  if (!ws) throw new ValidationError("The file has no sheet.", "file");
  const head = ws.getRow(1);
  const headers = Array.from({ length: head.cellCount + 1 }, (_, i) =>
    i === 0 ? "" : String(head.getCell(i).value ?? "").toLowerCase(),
  );
  const admCol = headers.findIndex((h) => h.startsWith("admission"));
  const markCol = headers.findIndex((h) => h.startsWith("mark"));
  if (admCol < 1 || markCol < 1)
    throw new ValidationError(
      "Use Kiota's template: it needs the Admission number and Mark columns.",
      "file",
    );
  const rows: { row: number; adm: string; value: string }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const cell = (c: number) => {
      const v = r.getCell(c).value;
      if (v && typeof v === "object" && "result" in v) return String(v.result ?? "");
      return v === null || v === undefined ? "" : String(v);
    };
    const adm = cell(admCol).trim();
    const value = cell(markCol).trim();
    if (adm && value) rows.push({ row: n, adm, value });
  });
  if (!rows.length) throw new ValidationError("The file has no marks in it.", "file");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const students = await sheetStudents(tx, q.streamId, q.subjectId);
      const byAdm = new Map(students.map((s) => [s.admissionNumber.toUpperCase(), s.id]));
      const problems: string[] = [];
      const entries: MarkEntry[] = [];
      for (const r of rows) {
        const id = byAdm.get(r.adm.toUpperCase());
        if (!id) problems.push(`Row ${r.row}: ${r.adm} is not on this mark sheet`);
        else entries.push({ studentId: id, assessmentId: q.assessmentId, value: r.value });
      }
      if (problems.length) throw new ValidationError(problems.slice(0, 5).join(". ") + ".", "file");
      const result = await saveMarksIn(tx, actor, { ...q, entries });
      if (result.errors.length) {
        const adm = new Map(students.map((s) => [s.id, s.admissionNumber]));
        throw new ValidationError(
          result.errors
            .slice(0, 5)
            .map((e) => `${adm.get(e.studentId)}: ${e.message}`)
            .join(". ") + ". Nothing was saved.",
          "file",
        );
      }
      return { saved: result.saved, rows: rows.length };
    },
    { timeoutMs: 30_000 },
  );
}
