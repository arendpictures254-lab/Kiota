/**
 * Report cards: everything one card shows, for one student or a whole stream (in admission
 * number order). reports.print: the Principal, Director of Studies and class teachers for their
 * own stream. Fee balances and attendance come through narrow database functions (a number,
 * never the ledger or the registers). Released cards carry a verification code: the QR code
 * opens kiota.app/v/<code>, which shows only the school, the student's name, the term and the
 * release date.
 */
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { schoolCrest } from "@/lib/fees/receipts";
import type { PrismaClient } from "@/generated/prisma/client";
import { SITE_URL } from "@/lib/hosts";
import { type Actor, type Deps, ctxOf } from "@/lib/service-kit";
import { getStorage } from "@/lib/storage";
import { formatHundredths, formatTenths } from "./grading";
import { initials, streamResultsIn } from "./results";
import { schemesIn } from "./setup";

export const verifyUrl = (token: string) => `${SITE_URL}/v/${token}`;

export type ReportCardView = Awaited<ReturnType<typeof reportCards>>["cards"][number];
export type ReportBundle = Awaited<ReturnType<typeof reportCards>>;

export async function reportCards(
  { db }: Deps,
  actor: Actor,
  q: { termId: string; streamId: string; studentId?: string; withImages?: boolean },
) {
  if (!actor.permissions.has("reports.print")) throw new ForbiddenError("reports.print");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const schoolId = actor.schoolId;
      const r = await streamResultsIn(tx, actor, q.termId, q.streamId);
      const p = actor.permissions;
      if (!r.isClassTeacher && !p.has("results.approve") && !p.has("academics.setup"))
        throw new ForbiddenError("reports.print");
      const students = r.students.filter((s) => !q.studentId || s.id === q.studentId);
      const ids = students.map((s) => s.id);
      const [school, settings, details, comments, ratings, competencies, schemes, cards, nextTerm] =
        await Promise.all([
          tx.school.findUniqueOrThrow({
            where: { id: schoolId },
            select: { id: true, name: true, county: true, logoUrl: true },
          }),
          tx.schoolSettings.findUnique({ where: { schoolId } }),
          tx.student.findMany({
            where: { schoolId, id: { in: ids } },
            select: { id: true, gender: true, boarder: true, photoKey: true, upi: true },
          }),
          tx.reportComment.findMany({
            where: { schoolId, termId: q.termId, studentId: { in: ids } },
          }),
          tx.competencyRating.findMany({
            where: { schoolId, termId: q.termId, studentId: { in: ids } },
          }),
          tx.competency.findMany({
            where: { schoolId, active: true },
            orderBy: [{ kind: "asc" }, { position: "asc" }],
          }),
          schemesIn(tx, schoolId),
          tx.reportCard.findMany({ where: { schoolId, termId: q.termId, studentId: { in: ids } } }),
          tx.term.findFirst({
            where: { schoolId, startDate: { gt: r.term.endDate } },
            orderBy: { startDate: "asc" },
            select: { startDate: true },
          }),
        ]);
      const showFee = settings?.reportShowFeeBalance ?? true;
      const showNext = settings?.reportShowNextTerm ?? true;
      const [balances, attendance] = await Promise.all([
        showFee
          ? tx.$queryRaw<{ student_id: string; balance_cents: bigint }[]>`
              SELECT * FROM app_report_fee_balances(${ids}::uuid[])`
          : Promise.resolve([]),
        tx.$queryRaw<
          { student_id: string; present: number; late: number; absent: number; on_leave: number }[]
        >`
          SELECT * FROM app_report_attendance(${q.termId}::uuid, ${ids}::uuid[])`,
      ]);
      const rubric = schemes.find((s) => s.forCompetencies)?.levels ?? [];
      const storage = getStorage();
      const crest = q.withImages ? await schoolCrest(school.logoUrl, school.id) : null;
      const out = [];
      for (const s of students) {
        const d = details.find((x) => x.id === s.id);
        const c = comments.find((x) => x.studentId === s.id);
        const att = attendance.find((a) => a.student_id === s.id);
        const card = cards.find((x) => x.studentId === s.id);
        const bal = balances.find((b) => b.student_id === s.id);
        const photo =
          q.withImages && d?.photoKey ? await storage.get(d.photoKey).catch(() => null) : null;
        out.push({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          admissionNumber: s.admissionNumber,
          upi: d?.upi ?? null,
          gender: d?.gender ?? null,
          boarder: d?.boarder ?? false,
          photo:
            photo && ["image/png", "image/jpeg"].includes(photo.contentType) ? photo.bytes : null,
          subjects: r.subjects.map((sub) => {
            const x = s.subjects[sub.id];
            const comp = r.completeness.find((c2) => c2.subjectId === sub.id);
            return {
              name: sub.name,
              score:
                x?.pctTenths != null ? formatTenths(x.pctTenths) : x ? statusText(x.status) : "–",
              code: x?.code ?? "",
              points: x?.points ?? null,
              comment:
                (r.scheme?.levels.find((l) => l.code === x?.code)?.comment as string | null) ?? "",
              initials: comp?.initials ?? "",
            };
          }),
          total: s.summary.count ? formatTenths(s.summary.totalTenths) : "–",
          outOf: s.summary.count * 100,
          mean: s.summary.meanTenths !== null ? formatTenths(s.summary.meanTenths) : "–",
          meanPoints:
            s.summary.meanPointsHundredths !== null
              ? formatHundredths(s.summary.meanPointsHundredths)
              : "–",
          meanGrade: s.summary.meanGrade ?? "–",
          meanGradeLabel: s.summary.meanGradeLabel ?? "",
          streamPosition: s.streamPosition,
          classPosition: s.classPosition,
          competencies: competencies.map((k) => {
            const rating = ratings.find(
              (x) => x.studentId === s.id && x.competencyId === k.id,
            )?.rating;
            const level = rubric.find((l) => l.points === rating);
            return {
              kind: k.kind,
              name: k.name,
              code: level?.code ?? "",
              label: level?.label ?? "",
            };
          }),
          attendance: att
            ? {
                present: att.present + att.late,
                late: att.late,
                absent: att.absent,
                onLeave: att.on_leave,
              }
            : null,
          classTeacherComment: c?.classTeacherComment ?? "",
          principalComment: c?.principalComment ?? "",
          feeBalanceCents: showFee && bal ? Number(bal.balance_cents) : null,
          token: card?.token ?? null,
        });
      }
      return {
        school: { name: school.name, county: school.county },
        crest: crest?.bytes ?? null,
        template:
          settings?.reportTemplate === "modern" ? ("modern" as const) : ("classic" as const),
        term: r.term,
        status: r.status,
        released: r.status === "released",
        releasedAt: r.record?.releasedAt ?? null,
        stream: r.stream,
        showPositions: r.showPositions,
        streamSize: r.streamSize,
        classSize: r.classSize,
        scheme: r.scheme,
        nextTermStart: showNext ? (nextTerm?.startDate ?? null) : null,
        showFee,
        cards: out,
      };
    },
    { timeoutMs: 60_000 },
  );
}

const statusText = (s: string) => (s === "absent" ? "Absent" : s === "exempt" ? "Exempt" : "–");

export { initials };

/** The public verification page: the four facts, or nothing. */
export async function verifyReportCard(db: PrismaClient, token: string) {
  const [row] = await db.$queryRaw<
    {
      school_name: string;
      student_name: string;
      term_name: string;
      year_name: string;
      released_at: Date;
    }[]
  >`SELECT * FROM app_verify_report_card(${token})`;
  return row
    ? {
        school: row.school_name,
        student: row.student_name,
        term: `${row.term_name} ${row.year_name}`,
        releasedAt: row.released_at,
      }
    : null;
}
