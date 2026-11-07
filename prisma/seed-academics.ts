/**
 * Academics seed for Bahari Academy (Term 3 2026), through the real services so marks, results,
 * locks and audit entries come out exactly as in use. Runs once: skipped when the school already
 * has marks.
 *  - Term 3 2026 with assessments and weights for the Junior School (CAT 1, CAT 2, End-term, and a
 *    Creative Arts project with its own weights) and 8-4-4 (CAT, End-term);
 *  - a Form 4 stream (8-4-4, positions on) with twelve students;
 *  - teaching assignments for every Junior School stream and Form 4;
 *  - Grade 7 East: complete, signed off, approved and released (report cards with QR codes);
 *  - Grade 8 East: complete and signed off, waiting for approval;
 *  - Form 4 Blue: marks still being entered (two subjects not finished);
 *  - a comment bank, class teacher and principal comments, and competency ratings.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { saveReportExtras } from "../src/lib/academics/comments";
import { saveMarks, submitMarks } from "../src/lib/academics/marks";
import {
  approveResults,
  releaseResults,
  signOffResults,
  streamResults,
} from "../src/lib/academics/results";
import { assignTeacher, saveAssessmentPlan } from "../src/lib/academics/setup";
import { BUILT_IN_ROLES } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { createAppClient } from "../src/lib/db-core";
import type { Actor } from "../src/lib/service-kit";

export const ACADEMICS_SEED = {
  directorOfStudies: "+254711000013",
  form4Teacher: "+254711000014",
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FORM4 = [
  ["Wanjiru", "Mwangi", "female"],
  ["Otieno", "Odhiambo", "male"],
  ["Achieng", "Atieno", "female"],
  ["Kiprotich", "Kipchumba", "male"],
  ["Nafula", "Wekesa", "female"],
  ["Mutua", "Musyoka", "male"],
  ["Halima", "Abdalla", "female"],
  ["Baraka", "Karisa", "male"],
  ["Zawadi", "Kahindi", "female"],
  ["Juma", "Mwachiro", "male"],
  ["Nekesa", "Barasa", "female"],
  ["Kamau", "Njoroge", "male"],
] as const;

export async function seedAcademics(owner: PrismaClient, schoolId: string) {
  if ((await owner.mark.count({ where: { schoolId } })) > 0) return;
  const userId = async (phone: string) =>
    (await owner.user.findUniqueOrThrow({ where: { phone } })).id;
  const actor = async (phone: string, role: string): Promise<Actor> => ({
    userId: await userId(phone),
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
      grants: [],
    }),
  });
  const memberId = async (phone: string) =>
    (await owner.membership.findFirstOrThrow({ where: { schoolId, user: { phone } } })).id;
  const app = createAppClient();
  const deps = { db: app };
  const rand = rng(2026);
  try {
    const director = await actor("+254711000001", "director");
    const principal = await actor("+254711000006", "principal");
    const dos = await actor(ACADEMICS_SEED.directorOfStudies, "director_of_studies");
    const teachers: Record<string, Actor> = {
      grace: await actor("+254711000003", "class_teacher"),
      daniel: await actor("+254711000009", "class_teacher"),
      ruth: await actor("+254711000010", "class_teacher"),
      kevin: await actor(ACADEMICS_SEED.form4Teacher, "class_teacher"),
      faith: await actor("+254733000001", "subject_teacher"),
      samuel: dos,
    };
    const phones: Record<string, string> = {
      grace: "+254711000003",
      daniel: "+254711000009",
      ruth: "+254711000010",
      kevin: ACADEMICS_SEED.form4Teacher,
      faith: "+254733000001",
      samuel: ACADEMICS_SEED.directorOfStudies,
    };

    // ---- Term 3 2026 ----
    const year = await owner.academicYear.upsert({
      where: { schoolId_name: { schoolId, name: "2026" } },
      create: {
        schoolId,
        name: "2026",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      },
      update: {},
    });
    const term = await owner.term.upsert({
      where: { academicYearId_name: { academicYearId: year.id, name: "Term 3" } },
      create: {
        schoolId,
        academicYearId: year.id,
        name: "Term 3",
        startDate: new Date("2026-08-31T00:00:00Z"),
        endDate: new Date("2026-10-30T00:00:00Z"),
      },
      update: {},
    });

    // ---- Form 4 (8-4-4) ----
    await owner.level.updateMany({
      where: { schoolId, key: "legacy_844" },
      data: { enabled: true },
    });
    const form4 = await owner.class.findUniqueOrThrow({
      where: { schoolId_name: { schoolId, name: "Form 4" } },
    });
    const blue = await owner.stream.upsert({
      where: { classId_name: { classId: form4.id, name: "Blue" } },
      create: {
        schoolId,
        classId: form4.id,
        name: "Blue",
        classTeacherMembershipId: await memberId(ACADEMICS_SEED.form4Teacher),
      },
      update: { classTeacherMembershipId: await memberId(ACADEMICS_SEED.form4Teacher) },
    });
    for (const [i, [first, last, gender]] of FORM4.entries()) {
      const admissionNumber = `BA/2023/${String(201 + i)}`;
      await owner.student.upsert({
        where: { schoolId_admissionNumber: { schoolId, admissionNumber } },
        create: {
          schoolId,
          admissionNumber,
          firstName: first,
          lastName: last,
          gender,
          dateOfBirth: new Date(`2009-${String((i % 12) + 1).padStart(2, "0")}-14`),
          classId: form4.id,
          streamId: blue.id,
          boarder: i % 4 !== 0,
        },
        update: {},
      });
    }

    // ---- Assessments and weights ----
    const levels = await owner.level.findMany({ where: { schoolId }, include: { subjects: true } });
    const junior = levels.find((l) => l.key === "junior")!;
    const legacy = levels.find((l) => l.key === "legacy_844")!;
    const art = junior.subjects.find((s) => s.name === "Creative Arts and Sports")!;
    await saveAssessmentPlan(deps, dos, term.id, junior.id, [
      { name: "CAT 1", maxMarks: "30", weight: "15", overrides: { [art.id]: "15" } },
      { name: "CAT 2", maxMarks: "30", weight: "15", overrides: { [art.id]: "0" } },
      { name: "End-term", maxMarks: "100", weight: "70", overrides: { [art.id]: "50" } },
      { name: "Project", maxMarks: "50", weight: "0", overrides: { [art.id]: "35" } },
    ]);
    await saveAssessmentPlan(deps, dos, term.id, legacy.id, [
      { name: "CAT", maxMarks: "30", weight: "30" },
      { name: "End-term", maxMarks: "100", weight: "70" },
    ]);

    // ---- Teaching assignments ----
    const streams = await owner.stream.findMany({
      where: { schoolId },
      include: {
        class: { include: { level: { include: { subjects: { orderBy: { name: "asc" } } } } } },
      },
    });
    const label = (s: (typeof streams)[number]) => `${s.class.name} ${s.name}`;
    const juniorRota: Record<string, string> = {
      English: "grace",
      Kiswahili: "ruth",
      Mathematics: "faith",
      "Integrated Science": "daniel",
      "Social Studies": "grace",
      "Pre-Technical Studies": "daniel",
      "Agriculture and Nutrition": "ruth",
      "Creative Arts and Sports": "samuel",
      "Religious Education": "ruth",
    };
    const form4Subjects: Record<string, string> = {
      English: "kevin",
      Kiswahili: "kevin",
      Mathematics: "faith",
      Biology: "samuel",
      Chemistry: "samuel",
      Physics: "faith",
      "History and Government": "kevin",
      "Business Studies": "samuel",
    };
    const teacherOf = new Map<string, string>();
    for (const s of streams) {
      const rota =
        s.class.level.key === "legacy_844"
          ? form4Subjects
          : s.class.level.key === "junior"
            ? juniorRota
            : null;
      if (!rota) continue;
      for (const sub of s.class.level.subjects) {
        const who = rota[sub.name];
        if (!who) continue;
        await assignTeacher(deps, dos, s.id, sub.id, await memberId(phones[who]));
        teacherOf.set(`${s.id}:${sub.id}`, who);
      }
    }

    // ---- Marks ----
    const ability = new Map<string, number>();
    async function enter(streamLabel: string, opts: { unfinished?: string[] } = {}) {
      const stream = streams.find((s) => label(s) === streamLabel)!;
      const students = await owner.student.findMany({
        where: { schoolId, streamId: stream.id, status: "active" },
        orderBy: { admissionNumber: "asc" },
      });
      const assessments = await owner.assessment.findMany({
        where: { schoolId, termId: term.id, levelId: stream.class.levelId },
        include: { weights: true },
        orderBy: { position: "asc" },
      });
      for (const st of students) if (!ability.has(st.id)) ability.set(st.id, 0.35 + rand() * 0.55);
      for (const sub of stream.class.level.subjects) {
        const who = teacherOf.get(`${stream.id}:${sub.id}`);
        if (!who) continue;
        const counted = assessments.filter(
          (a) => (a.weights.find((w) => w.subjectId === sub.id)?.weight ?? a.weight) > 0,
        );
        const unfinished = opts.unfinished?.includes(sub.name);
        const subjectBias = rand() * 0.2 - 0.1;
        const entries = [];
        for (const [i, st] of students.entries()) {
          for (const a of counted) {
            if (unfinished && a.name === "End-term" && i >= students.length / 2) continue;
            let value: string;
            if (i === 3 && a.name === "CAT 2")
              value = "A"; // absent for one CAT
            else if (i === 5 && sub.name === "Religious Education")
              value = "X"; // exempt
            else {
              const p = Math.min(
                1,
                Math.max(0.05, ability.get(st.id)! + subjectBias + (rand() - 0.5) * 0.25),
              );
              value = String(Math.round(p * a.maxMarks));
            }
            entries.push({ studentId: st.id, assessmentId: a.id, value });
          }
        }
        const r = await saveMarks(deps, teachers[who], {
          termId: term.id,
          streamId: stream.id,
          subjectId: sub.id,
          entries,
        });
        if (r.errors.length) throw new Error(`Seed marks: ${JSON.stringify(r.errors[0])}`);
        if (!unfinished)
          for (const a of counted)
            await submitMarks(deps, teachers[who], {
              termId: term.id,
              streamId: stream.id,
              subjectId: sub.id,
              assessmentId: a.id,
            });
      }
      return { stream, students };
    }

    const g7e = await enter("Grade 7 East");
    const g8e = await enter("Grade 8 East");
    const f4 = await enter("Form 4 Blue", { unfinished: ["Physics", "Business Studies"] });

    // ---- Comment bank ----
    const bank: [string, string, string, string][] = [
      [
        junior.id,
        "class_teacher",
        "EE",
        "An outstanding term. Keep up the hard work and curiosity.",
      ],
      [junior.id, "class_teacher", "ME", "A good term's work. Keep revising steadily."],
      [junior.id, "class_teacher", "AE", "Making progress. More practice at home will help."],
      [
        junior.id,
        "class_teacher",
        "BE",
        "Needs more effort and support. Let us work on this together.",
      ],
      [junior.id, "principal", "EE", "Excellent results. Well done."],
      [junior.id, "principal", "ME", "Good work. Aim higher next term."],
      [junior.id, "principal", "AE", "Fair progress. Work closely with your teachers."],
      [junior.id, "principal", "BE", "We expect more effort next term."],
      [legacy.id, "class_teacher", "A", "Excellent work. You are on course for a top grade."],
      [legacy.id, "class_teacher", "B", "Good work. Push for an A."],
      [legacy.id, "class_teacher", "C", "Average. Revise consistently to improve."],
      [legacy.id, "class_teacher", "D", "Below expectations. Seek help in weak subjects."],
      [legacy.id, "principal", "B", "Good. Keep focused for KCSE."],
    ];
    await owner.commentBank.createMany({
      data: bank.map(([levelId, author, bandCode, text]) => ({
        schoolId,
        levelId,
        author,
        bandCode,
        text,
      })),
    });

    // ---- Comments, ratings and the workflow ----
    const competencies = await owner.competency.findMany({ where: { schoolId } });
    async function comment(
      who: Actor,
      streamId: string,
      studentIds: string[],
      principalToo: boolean,
    ) {
      const r = await streamResults(deps, who, term.id, streamId);
      for (const id of studentIds) {
        const s = r.students.find((x) => x.id === id)!;
        const band = s.summary.meanGrade ?? "ME";
        const text = band.startsWith("EE")
          ? `${s.firstName} has had an outstanding term. Keep it up.`
          : band.startsWith("ME")
            ? `${s.firstName} works steadily and participates well in class.`
            : `${s.firstName} is improving but needs more practice in the weaker subjects.`;
        await saveReportExtras(deps, who, {
          termId: term.id,
          streamId,
          studentId: id,
          classTeacherComment: text,
          ratings: Object.fromEntries(
            competencies.map((c) => [
              c.id,
              String(
                Math.min(4, Math.max(1, Math.round(1.5 + ability.get(id)! * 2.8 + rand() - 0.5))),
              ),
            ]),
          ),
        });
        if (principalToo)
          await saveReportExtras(deps, principal, {
            termId: term.id,
            streamId,
            studentId: id,
            principalComment: band.startsWith("EE")
              ? "Excellent results. Well done."
              : "Good effort. Aim higher next term.",
          });
      }
    }
    await comment(
      teachers.grace,
      g7e.stream.id,
      g7e.students.map((s) => s.id),
      true,
    );
    await signOffResults(deps, teachers.grace, term.id, g7e.stream.id);
    await approveResults(deps, dos, term.id, g7e.stream.id);
    await releaseResults(deps, principal, term.id, g7e.stream.id, new Date("2026-10-30T09:00:00Z"));

    await comment(
      teachers.ruth,
      g8e.stream.id,
      g8e.students.slice(0, 8).map((s) => s.id),
      false,
    );
    await signOffResults(deps, teachers.ruth, term.id, g8e.stream.id);

    void f4;
    void director;
  } finally {
    await app.$disconnect();
  }
}
