/**
 * Results and sign-off. A stream's term results come straight from its marks (never typed):
 * each subject's weighted assessments give a percentage and the scheme's level or grade; then
 * totals, mean score, mean points, mean grade and (when the level shows them) positions in the
 * stream and the class.
 *
 * Workflow per stream and term: draft → signed_off (the class teacher, once every subject's
 * marks are submitted; marks lock) → approved (Principal or Director of Studies) → released
 * (report cards issued, each with a verification code). An approver can send it back to draft
 * with a reason. Every step is audited.
 */
import { randomBytes } from "node:crypto";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import {
  type MarkValue,
  type Scheme,
  type SchemeLevel,
  type StudentSummary,
  gradeFor,
  gradedTenths,
  positions,
  studentSummary,
  subjectResult,
  weightFor,
} from "./grading";
import { sheetStudents, streamLevel, streamStatus } from "./marks";
import {
  type AssessmentRow,
  assertSeeAcademics,
  assessmentsFor,
  positionsOn,
  schemeOf,
  schemesIn,
  termsIn,
} from "./setup";

export const RESULT_STATUS: Record<string, string> = {
  draft: "Marks being entered",
  signed_off: "Waiting for approval",
  approved: "Approved",
  released: "Released",
};

type MarkRow = {
  studentId: string;
  assessmentId: string;
  subjectId: string;
  status: string;
  scoreTenths: number | null;
};

/** Every student's subject results and summary, from raw marks. */
export function computeResults(
  scheme: Scheme,
  assessments: AssessmentRow[],
  subjectIds: string[],
  studentIds: string[],
  marks: MarkRow[],
) {
  const byStudent = new Map<string, Map<string, Map<string, MarkValue>>>();
  for (const m of marks) {
    let subj = byStudent.get(m.studentId);
    if (!subj) byStudent.set(m.studentId, (subj = new Map()));
    let am = subj.get(m.subjectId);
    if (!am) subj.set(m.subjectId, (am = new Map()));
    am.set(m.assessmentId, { status: m.status as MarkValue["status"], scoreTenths: m.scoreTenths });
  }
  const out = new Map<
    string,
    {
      subjects: Map<
        string,
        { pctTenths: number | null; status: string; level: SchemeLevel | null }
      >;
      summary: StudentSummary;
    }
  >();
  for (const studentId of studentIds) {
    const subjMarks = byStudent.get(studentId);
    const subjects = new Map<
      string,
      { pctTenths: number | null; status: string; level: SchemeLevel | null }
    >();
    for (const subjectId of subjectIds) {
      const am = subjMarks?.get(subjectId);
      if (!am) continue; // not taking it, or nothing entered
      const r = subjectResult(
        assessments.map((a) => ({
          id: a.id,
          maxMarks: a.maxMarks,
          weight: weightFor(a, subjectId),
        })),
        am,
      );
      subjects.set(subjectId, {
        pctTenths: r.pctTenths === null ? null : gradedTenths(scheme, r.pctTenths),
        status: r.status,
        level: r.pctTenths === null ? null : gradeFor(scheme, r.pctTenths),
      });
    }
    const raw = [...subjects.values()].map((s) => s.pctTenths);
    out.set(studentId, { subjects, summary: studentSummary(scheme, raw) });
  }
  return out;
}

async function classPositions(
  tx: Tx,
  scheme: Scheme,
  assessments: AssessmentRow[],
  subjectIds: string[],
  termId: string,
  streamId: string,
) {
  const rows = await tx.$queryRaw<
    {
      student_id: string;
      assessment_id: string;
      subject_id: string;
      status: string;
      score_tenths: number | null;
    }[]
  >`SELECT * FROM app_class_marks(${streamId}::uuid, ${termId}::uuid)`;
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const results = computeResults(
    scheme,
    assessments,
    subjectIds,
    ids,
    rows.map((r) => ({
      studentId: r.student_id,
      assessmentId: r.assessment_id,
      subjectId: r.subject_id,
      status: r.status,
      scoreTenths: r.score_tenths,
    })),
  );
  return {
    size: ids.length,
    positions: positions(ids.map((id) => ({ id, ...results.get(id)!.summary }))),
  };
}

/** Everything about one stream's term results: completeness, results table and workflow. */
export async function streamResults({ db }: Deps, actor: Actor, termId: string, streamId: string) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), (tx) => streamResultsIn(tx, actor, termId, streamId), {
    timeoutMs: 30_000,
  });
}

export async function streamResultsIn(tx: Tx, actor: Actor, termId: string, streamId: string) {
  const schoolId = actor.schoolId;
  const [visible] = await tx.$queryRaw<
    { ok: boolean }[]
  >`SELECT app_can_see_marks(${streamId}::uuid) AS ok`;
  if (!visible?.ok) throw new ForbiddenError("academics.view");
  const stream = await streamLevel(tx, schoolId, streamId);
  const term = (await termsIn(tx, schoolId)).find((t) => t.id === termId);
  if (!term) throw new ValidationError("Term not found.");
  const level = stream.class.level;
  const scheme = schemeOf(await schemesIn(tx, schoolId), level);
  const schemeData: Scheme = scheme ?? { roundMarks: true, levels: [] };
  const showPositions = positionsOn(level, scheme);
  const assessments = await assessmentsFor(tx, schoolId, termId, level.id);
  const [subjects, assignments, submissions, students, marks, record] = await Promise.all([
    tx.subject.findMany({
      where: { schoolId, levelId: level.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    tx.teachingAssignment.findMany({
      where: { schoolId, streamId },
      include: { teacher: { select: { displayName: true } } },
    }),
    tx.markSubmission.findMany({
      where: { schoolId, streamId, assessmentId: { in: assessments.map((a) => a.id) } },
      select: { assessmentId: true, subjectId: true },
    }),
    sheetStudents(tx, streamId, null),
    tx.mark.findMany({
      where: { schoolId, streamId, assessmentId: { in: assessments.map((a) => a.id) } },
      select: {
        studentId: true,
        assessmentId: true,
        subjectId: true,
        status: true,
        scoreTenths: true,
      },
    }),
    tx.streamResult.findUnique({ where: { schoolId, termId_streamId: { termId, streamId } } }),
  ]);
  const markedSubjects = new Set(marks.map((m) => m.subjectId));
  const offered = subjects.filter(
    (s) => assignments.some((a) => a.subjectId === s.id) || markedSubjects.has(s.id),
  );
  const completeness = offered.map((s) => {
    const needed = assessments.filter((a) => weightFor(a, s.id) > 0);
    const done = needed.filter((a) =>
      submissions.some((x) => x.subjectId === s.id && x.assessmentId === a.id),
    );
    const teacher = assignments.find((a) => a.subjectId === s.id)?.teacher.displayName ?? null;
    return {
      subjectId: s.id,
      subject: s.name,
      teacher,
      initials: initials(teacher),
      needed: needed.length,
      submitted: done.length,
      complete: needed.length > 0 && done.length === needed.length,
    };
  });

  const results = computeResults(
    schemeData,
    assessments,
    offered.map((s) => s.id),
    students.map((s) => s.id),
    marks,
  );
  const streamPos = positions(students.map((s) => ({ id: s.id, ...results.get(s.id)!.summary })));
  const cls = showPositions
    ? await classPositions(
        tx,
        schemeData,
        assessments,
        offered.map((s) => s.id),
        termId,
        streamId,
      )
    : null;
  const [myStreams] = await tx.$queryRaw<{ ids: string[] }[]>`SELECT app_my_stream_ids() AS ids`;
  const isClassTeacher = (myStreams?.ids ?? []).includes(streamId);
  const status = record?.status ?? "draft";
  const p = actor.permissions;
  return {
    term,
    stream: {
      id: stream.id,
      name: `${stream.class.name} ${stream.name}`,
      className: stream.class.name,
      levelId: level.id,
      levelName: level.name,
      classTeacher: stream.classTeacher?.displayName ?? null,
    },
    scheme: scheme ? { name: scheme.name, note: scheme.note, levels: scheme.levels } : null,
    showPositions,
    assessments: assessments.map((a) => ({ id: a.id, name: a.name, maxMarks: a.maxMarks })),
    subjects: offered,
    completeness,
    allComplete: completeness.length > 0 && completeness.every((c) => c.complete),
    status,
    record: record
      ? {
          signedOffAt: record.signedOffAt,
          approvedAt: record.approvedAt,
          releasedAt: record.releasedAt,
          returnedReason: record.returnedReason,
        }
      : null,
    can: {
      signOff:
        status === "draft" &&
        ((p.has("marks.signoff") && isClassTeacher) || p.has("results.approve")),
      approve: status === "signed_off" && p.has("results.approve"),
      release: status === "approved" && p.has("results.approve"),
      sendBack: (status === "signed_off" || status === "approved") && p.has("results.approve"),
      comment:
        status !== "released" &&
        ((p.has("marks.signoff") && isClassTeacher) || p.has("results.approve")),
      print: p.has("reports.print"),
    },
    isClassTeacher,
    students: students.map((s) => {
      const r = results.get(s.id)!;
      return {
        ...s,
        subjects: Object.fromEntries(
          [...r.subjects].map(([k, v]) => [
            k,
            {
              pctTenths: v.pctTenths,
              status: v.status,
              code: v.level?.code ?? null,
              points: v.level?.points ?? null,
            },
          ]),
        ),
        summary: {
          count: r.summary.count,
          totalTenths: r.summary.totalTenths,
          meanTenths: r.summary.meanTenths,
          meanPointsHundredths: r.summary.meanPointsHundredths,
          meanGrade: r.summary.meanGrade?.code ?? null,
          meanGradeLabel: r.summary.meanGrade?.label ?? null,
          meanGradeComment: r.summary.meanGrade?.comment ?? null,
        },
        streamPosition: showPositions ? (streamPos.get(s.id) ?? null) : null,
        classPosition: cls ? (cls.positions.get(s.id) ?? null) : null,
      };
    }),
    streamSize: students.length,
    classSize: cls?.size ?? null,
  };
}
export type StreamResultsView = Awaited<ReturnType<typeof streamResultsIn>>;

export function initials(name: string | null) {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

async function setStatus(
  tx: Tx,
  actor: Actor,
  termId: string,
  streamId: string,
  data: Record<string, unknown>,
) {
  await tx.streamResult.upsert({
    where: { schoolId: actor.schoolId, termId_streamId: { termId, streamId } },
    create: { schoolId: actor.schoolId, termId, streamId, ...data },
    update: data,
  });
}

/** The class teacher signs the stream off: every subject submitted. Marks lock. */
export async function signOffResults({ db }: Deps, actor: Actor, termId: string, streamId: string) {
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const r = await streamResultsIn(tx, actor, termId, streamId);
      if (r.status !== "draft") throw new ValidationError("Already signed off.");
      if (!r.can.signOff) throw new ForbiddenError("marks.signoff");
      if (!r.allComplete) {
        const open = r.completeness.filter((c) => !c.complete).map((c) => c.subject);
        throw new ValidationError(
          open.length
            ? `Not every subject is submitted yet: ${open.join(", ")}.`
            : "No subjects are taught in this stream yet.",
        );
      }
      await setStatus(tx, actor, termId, streamId, {
        status: "signed_off",
        signedOffById: actor.userId,
        signedOffAt: new Date(),
        returnedReason: null,
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "results.signoff",
        targetType: "stream",
        targetId: streamId,
        after: { termId },
        ip: actor.ip,
      });
    },
    { timeoutMs: 30_000 },
  );
}

export async function approveResults({ db }: Deps, actor: Actor, termId: string, streamId: string) {
  if (!actor.permissions.has("results.approve")) throw new ForbiddenError("results.approve");
  return withContext(db, ctxOf(actor), async (tx) => {
    const status = await streamStatus(tx, actor.schoolId, termId, streamId);
    if (status !== "signed_off")
      throw new ValidationError("The class teacher has not signed off yet.");
    await setStatus(tx, actor, termId, streamId, {
      status: "approved",
      approvedById: actor.userId,
      approvedAt: new Date(),
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "results.approve",
      targetType: "stream",
      targetId: streamId,
      after: { termId },
      ip: actor.ip,
    });
  });
}

/** Release: report cards are issued, each with its own verification code. Final. */
export async function releaseResults(
  { db }: Deps,
  actor: Actor,
  termId: string,
  streamId: string,
  now = new Date(),
) {
  if (!actor.permissions.has("results.approve")) throw new ForbiddenError("results.approve");
  return withContext(db, ctxOf(actor), async (tx) => {
    const status = await streamStatus(tx, actor.schoolId, termId, streamId);
    if (status !== "approved")
      throw new ValidationError("Approve the results before releasing them.");
    const students = await sheetStudents(tx, streamId, null);
    await setStatus(tx, actor, termId, streamId, {
      status: "released",
      releasedById: actor.userId,
      releasedAt: now,
    });
    await tx.reportCard.createMany({
      data: students.map((s) => ({
        schoolId: actor.schoolId,
        termId,
        streamId,
        studentId: s.id,
        token: randomBytes(18).toString("base64url"),
        releasedAt: now,
      })),
      skipDuplicates: true,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "results.release",
      targetType: "stream",
      targetId: streamId,
      after: { termId, reportCards: students.length },
      ip: actor.ip,
    });
    return students.length;
  });
}

/** An approver sends the results back to the class teacher (marks unlock). */
export async function sendBackResults(
  { db }: Deps,
  actor: Actor,
  termId: string,
  streamId: string,
  rawReason: unknown,
) {
  if (!actor.permissions.has("results.approve")) throw new ForbiddenError("results.approve");
  const reason = clean(rawReason);
  if (!reason) throw new ValidationError("Say what needs fixing.", "reason");
  return withContext(db, ctxOf(actor), async (tx) => {
    const status = await streamStatus(tx, actor.schoolId, termId, streamId);
    if (status !== "signed_off" && status !== "approved")
      throw new ValidationError("Only signed-off results can be sent back.");
    await setStatus(tx, actor, termId, streamId, {
      status: "draft",
      returnedReason: reason,
      approvedById: null,
      approvedAt: null,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "results.send_back",
      targetType: "stream",
      targetId: streamId,
      before: { status },
      after: { status: "draft", reason, termId },
      ip: actor.ip,
    });
  });
}

/** The streams a person works with this term, and where each one is. */
export async function resultsOverview({ db }: Deps, actor: Actor, termId: string) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const schoolId = actor.schoolId;
    const all =
      actor.permissions.has("results.approve") || actor.permissions.has("academics.setup");
    const [mine] = await tx.$queryRaw<{ ids: string[] }[]>`SELECT app_my_stream_ids() AS ids`;
    const streams = await tx.stream.findMany({
      where: {
        schoolId,
        class: { level: { enabled: true } },
        ...(all ? {} : { id: { in: mine?.ids ?? [] } }),
      },
      include: { class: { include: { level: true } } },
      orderBy: [
        { class: { level: { sortOrder: "asc" } } },
        { class: { position: "asc" } },
        { name: "asc" },
      ],
    });
    const levelAssessments = new Map<string, AssessmentRow[]>();
    for (const s of streams)
      if (!levelAssessments.has(s.class.levelId))
        levelAssessments.set(
          s.class.levelId,
          await assessmentsFor(tx, schoolId, termId, s.class.levelId),
        );
    const termAssessmentIds = [...levelAssessments.values()].flat().map((x) => x.id);
    const [records, assignments, submissions] = await Promise.all([
      tx.streamResult.findMany({ where: { schoolId, termId } }),
      tx.teachingAssignment.findMany({
        where: { schoolId, streamId: { in: streams.map((s) => s.id) } },
      }),
      tx.markSubmission.findMany({
        where: {
          schoolId,
          streamId: { in: streams.map((s) => s.id) },
          assessmentId: { in: termAssessmentIds },
        },
        select: { streamId: true, subjectId: true, assessmentId: true },
      }),
    ]);
    return streams.map((s) => {
      const as = levelAssessments.get(s.class.levelId)!;
      const subs = assignments.filter((a) => a.streamId === s.id);
      const complete = subs.filter((a) => {
        const needed = as.filter((x) => weightFor(x, a.subjectId) > 0);
        return (
          needed.length > 0 &&
          needed.every((x) =>
            submissions.some(
              (y) => y.streamId === s.id && y.subjectId === a.subjectId && y.assessmentId === x.id,
            ),
          )
        );
      }).length;
      return {
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        level: s.class.level.name,
        status: records.find((r) => r.streamId === s.id)?.status ?? "draft",
        subjects: subs.length,
        complete,
        hasAssessments: as.length > 0,
        mine: (mine?.ids ?? []).includes(s.id),
      };
    });
  });
}
