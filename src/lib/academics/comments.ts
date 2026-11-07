/**
 * Report comments and ratings. The class teacher writes a comment for each student in their
 * stream and rates the core competencies and values on the 4-level rubric; the principal (or
 * Director of Studies: results.approve) adds theirs. Suggested comments come from the school's
 * comment bank for the student's level and mean grade. Locked once the results are released.
 */
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { streamResultsIn } from "./results";
import { schemesIn } from "./setup";

export async function studentReportExtras(
  { db }: Deps,
  actor: Actor,
  termId: string,
  streamId: string,
  studentId: string,
) {
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const schoolId = actor.schoolId;
      const results = await streamResultsIn(tx, actor, termId, streamId);
      const index = results.students.findIndex((s) => s.id === studentId);
      if (index < 0) return null;
      const student = results.students[index];
      const [comment, ratings, competencies, bank, schemes] = await Promise.all([
        tx.reportComment.findUnique({
          where: { schoolId, termId_studentId: { termId, studentId } },
        }),
        tx.competencyRating.findMany({ where: { schoolId, termId, studentId } }),
        tx.competency.findMany({
          where: { schoolId, active: true },
          orderBy: [{ kind: "asc" }, { position: "asc" }],
        }),
        tx.commentBank.findMany({
          where: { schoolId, levelId: results.stream.levelId },
          orderBy: { createdAt: "asc" },
        }),
        schemesIn(tx, schoolId),
      ]);
      const rubric = schemes.find((s) => s.forCompetencies) ?? null;
      const band = student.summary.meanGrade;
      // Suggestions for this student's mean grade first; its first letters (EE for EE1) also match.
      const fits = (code: string) => !!band && (code === band || band.startsWith(code));
      return {
        results,
        student,
        previous: results.students[index - 1]?.id ?? null,
        next: results.students[index + 1]?.id ?? null,
        classTeacherComment: comment?.classTeacherComment ?? "",
        principalComment: comment?.principalComment ?? "",
        ratings: Object.fromEntries(ratings.map((r) => [r.competencyId, r.rating])),
        competencies: competencies.map((c) => ({ id: c.id, kind: c.kind, name: c.name })),
        rubric: (rubric?.levels ?? []).map((l) => ({
          code: l.code,
          label: l.label,
          points: l.points,
        })),
        suggestions: {
          class_teacher: bank
            .filter((b) => b.author === "class_teacher")
            .sort((a, b) => Number(fits(b.bandCode)) - Number(fits(a.bandCode)))
            .map((b) => ({ id: b.id, band: b.bandCode, text: b.text, fits: fits(b.bandCode) })),
          principal: bank
            .filter((b) => b.author === "principal")
            .sort((a, b) => Number(fits(b.bandCode)) - Number(fits(a.bandCode)))
            .map((b) => ({ id: b.id, band: b.bandCode, text: b.text, fits: fits(b.bandCode) })),
        },
        canClassTeacher: results.can.comment,
        canPrincipal: results.status !== "released" && actor.permissions.has("results.approve"),
      };
    },
    { timeoutMs: 30_000 },
  );
}

/** Save comments and ratings (each part only by who may write it). */
export async function saveReportExtras(
  { db }: Deps,
  actor: Actor,
  input: {
    termId: string;
    streamId: string;
    studentId: string;
    classTeacherComment?: unknown;
    principalComment?: unknown;
    ratings?: Record<string, unknown>;
  },
) {
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const schoolId = actor.schoolId;
      const results = await streamResultsIn(tx, actor, input.termId, input.streamId);
      if (!results.students.some((s) => s.id === input.studentId))
        throw new ValidationError("Student not found in this stream.");
      if (results.status === "released")
        throw new ValidationError("These results are released: comments can no longer change.");
      const classTeacherPart =
        input.classTeacherComment !== undefined || input.ratings !== undefined;
      if (classTeacherPart && !results.can.comment) throw new ForbiddenError("marks.signoff");
      if (input.principalComment !== undefined && !actor.permissions.has("results.approve"))
        throw new ForbiddenError("results.approve");
      const data: { classTeacherComment?: string | null; principalComment?: string | null } = {};
      if (input.classTeacherComment !== undefined)
        data.classTeacherComment = clean(input.classTeacherComment);
      if (input.principalComment !== undefined)
        data.principalComment = clean(input.principalComment);
      for (const v of Object.values(data))
        if (v && v.length > 600) throw new ValidationError("Keep a comment under 600 characters.");
      const before = await tx.reportComment.findUnique({
        where: { schoolId, termId_studentId: { termId: input.termId, studentId: input.studentId } },
      });
      if (Object.keys(data).length)
        await tx.reportComment.upsert({
          where: {
            schoolId,
            termId_studentId: { termId: input.termId, studentId: input.studentId },
          },
          create: {
            schoolId,
            termId: input.termId,
            studentId: input.studentId,
            updatedById: actor.userId,
            ...data,
          },
          update: { ...data, updatedById: actor.userId },
        });
      const ratings: Record<string, number> = {};
      if (input.ratings) {
        const ids = new Set(
          (await tx.competency.findMany({ where: { schoolId }, select: { id: true } })).map(
            (c) => c.id,
          ),
        );
        for (const [competencyId, raw] of Object.entries(input.ratings)) {
          if (!ids.has(competencyId)) continue;
          const rating = Number(raw);
          if (!raw) {
            await tx.competencyRating.deleteMany({
              where: { schoolId, termId: input.termId, studentId: input.studentId, competencyId },
            });
            continue;
          }
          if (!Number.isInteger(rating) || rating < 1 || rating > 4)
            throw new ValidationError("Ratings go from 1 to 4.");
          ratings[competencyId] = rating;
          await tx.competencyRating.upsert({
            where: {
              schoolId,
              termId_studentId_competencyId: {
                termId: input.termId,
                studentId: input.studentId,
                competencyId,
              },
            },
            create: {
              schoolId,
              termId: input.termId,
              studentId: input.studentId,
              competencyId,
              rating,
              ratedById: actor.userId,
            },
            update: { rating, ratedById: actor.userId },
          });
        }
      }
      await audit(tx, {
        schoolId,
        actorId: actor.userId,
        action: "report.comment",
        targetType: "student",
        targetId: input.studentId,
        before: before
          ? {
              classTeacherComment: before.classTeacherComment,
              principalComment: before.principalComment,
            }
          : undefined,
        after: { ...data, ratings, termId: input.termId },
        ip: actor.ip,
      });
    },
    { timeoutMs: 30_000 },
  );
}
