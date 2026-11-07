import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { type Actor, ValidationError } from "@/lib/service-kit";
import {
  app,
  appUnguarded,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
} from "../../../tests/db-helpers";
import { saveReportExtras } from "./comments";
import {
  markSheet,
  myMarkSheets,
  saveMarks,
  submitMarks,
  uploadMarks,
  markTemplate,
} from "./marks";
import { reportCardsPdf } from "./pdf";
import { reportCards, verifyReportCard } from "./reportcards";
import {
  approveResults,
  releaseResults,
  sendBackResults,
  signOffResults,
  streamResults,
} from "./results";
import { academicsSetup, assignTeacher, saveAssessmentPlan, setLevelGrading } from "./setup";

const deps = { db: app };

function actorFor(schoolId: string, userId: string, role: string): Actor {
  return {
    userId,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions as PermissionKey[],
      grants: [],
    }),
  };
}

async function makeFixture(label: string) {
  const school = await makeSchool(`${label} ${Date.now()}`, ["primary", "junior", "legacy_844"]);
  const member = async (role: string, name = role) => {
    const m = await makeMember(school.id, [role], name);
    return { ...m, actor: actorFor(school.id, m.user.id, role) };
  };
  const director = await member("director");
  const principal = await member("principal");
  const dos = await member("director_of_studies");
  const classTeacher = await member("class_teacher", "Grace Wanjiru");
  const english = await member("subject_teacher", "Faith Njeri");
  const maths = await member("subject_teacher", "Kevin Odhiambo");
  const east = await makeStream(school.id, "Grade 7", "East");
  const west = await makeStream(school.id, "Grade 7", "West");
  await owner.stream.update({
    where: { id: east.id },
    data: { classTeacherMembershipId: classTeacher.membership.id },
  });
  const students = [];
  for (const [i, n] of ["Amani", "Baraka", "Chausiku"].entries())
    students.push(
      await makeStudent(school.id, east.id, {
        firstName: n,
        lastName: "Test",
        admissionNumber: `${label.slice(0, 2)}/${i + 1}`,
      }),
    );
  const westStudent = await makeStudent(school.id, west.id, { firstName: "Daudi" });
  const year = await owner.academicYear.create({
    data: {
      schoolId: school.id,
      name: "2026",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    },
  });
  const term = await owner.term.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: "Term 3",
      startDate: new Date("2026-08-26"),
      endDate: new Date("2026-10-30"),
    },
  });
  const junior = await owner.level.findFirstOrThrow({
    where: { schoolId: school.id, key: "junior" },
  });
  const subject = (name: string) =>
    owner.subject.findFirstOrThrow({ where: { schoolId: school.id, levelId: junior.id, name } });
  const eng = await subject("English");
  const math = await subject("Mathematics");
  const d = director.actor;
  await saveAssessmentPlan(deps, d, term.id, junior.id, [
    { name: "CAT 1", maxMarks: "30", weight: "30" },
    { name: "End-term", maxMarks: "100", weight: "70" },
  ]);
  const assessments = await owner.assessment.findMany({
    where: { schoolId: school.id, termId: term.id },
    orderBy: { position: "asc" },
  });
  await assignTeacher(deps, d, east.id, eng.id, english.membership.id);
  await assignTeacher(deps, d, east.id, math.id, maths.membership.id);
  await assignTeacher(deps, d, west.id, eng.id, english.membership.id);
  return {
    school,
    director,
    principal,
    dos,
    classTeacher,
    english,
    maths,
    east,
    west,
    students,
    westStudent,
    term,
    junior,
    eng,
    math,
    cat: assessments[0],
    end: assessments[1],
  };
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const sheet = (f: Fixture, subjectId: string, streamId = f.east.id) => ({
  termId: f.term.id,
  streamId,
  subjectId,
});

/** Enter and submit a full sheet: marks[i] = [CAT 1 out of 30, End-term out of 100]. */
async function fillSheet(f: Fixture, teacher: Actor, subjectId: string, marks: [string, string][]) {
  const entries = f.students.flatMap((s, i) => [
    { studentId: s.id, assessmentId: f.cat.id, value: marks[i][0] },
    { studentId: s.id, assessmentId: f.end.id, value: marks[i][1] },
  ]);
  const r = await saveMarks(deps, teacher, { ...sheet(f, subjectId), entries });
  expect(r.errors).toEqual([]);
  for (const a of [f.cat, f.end])
    await submitMarks(deps, teacher, { ...sheet(f, subjectId), assessmentId: a.id });
}

let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeFixture("Acad A");
  B = await makeFixture("Acad B");
}, 60_000);

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
  await appUnguarded.$disconnect();
});

describe("configuration", () => {
  it("copies the Kenyan grading defaults, flagged for confirmation", async () => {
    const s = await academicsSetup(deps, A.director.actor);
    const names = s.schemes.map((x) => x.name);
    expect(names).toEqual([
      "CBC rubric (4 levels)",
      "Junior School (8 levels)",
      "Senior School (8 levels, provisional)",
      "KCSE (8-4-4)",
    ]);
    expect(s.schemes[0].note).toMatch(/Confirm against current KNEC guidance/);
    expect(s.schemes[1].note).toMatch(/Confirm against current KNEC guidance/);
    expect(s.schemes[2].note).toMatch(/to be confirmed when KNEC publishes/i);
    const ee1 = s.schemes[1].levels[0];
    expect(ee1).toMatchObject({
      code: "EE1",
      points: 8,
      minMark: 90,
      maxMark: 100,
      label: "Exceptional",
    });
    expect(s.schemes[3].levels.map((l) => l.code)).toEqual([
      "A",
      "A-",
      "B+",
      "B",
      "B-",
      "C+",
      "C",
      "C-",
      "D+",
      "D",
      "D-",
      "E",
    ]);
    const competencies = s.competencies.filter((c) => c.kind === "competency");
    const values = s.competencies.filter((c) => c.kind === "value");
    expect(competencies).toHaveLength(7);
    expect(values.map((v) => v.name)).toContain("Social justice");
    expect(values).toHaveLength(8);
  });

  it("refuses assessment weights that don't add up to 100 for every subject", async () => {
    const d = A.director.actor;
    await expect(
      saveAssessmentPlan(deps, d, A.term.id, A.junior.id, [
        { name: "CAT 1", maxMarks: "30", weight: "30" },
        { name: "End-term", maxMarks: "100", weight: "60" },
      ]),
    ).rejects.toThrow(/add up to 100%.*English 90%/);
    // One subject's own weights must also total 100.
    await expect(
      saveAssessmentPlan(deps, d, A.term.id, A.junior.id, [
        { id: A.cat.id, name: "CAT 1", maxMarks: "30", weight: "30" },
        {
          id: A.end.id,
          name: "End-term",
          maxMarks: "100",
          weight: "70",
          overrides: { [A.eng.id]: "50" },
        },
      ]),
    ).rejects.toThrow(/English 80%/);
    // A subject teacher can't change the plan at all.
    await expect(
      saveAssessmentPlan(deps, A.english.actor, A.term.id, A.junior.id, []),
    ).rejects.toThrow(ForbiddenError);
  });

  it("positions are off for CBC levels by default and on for 8-4-4", async () => {
    const s = await academicsSetup(deps, A.director.actor);
    expect(s.levels.find((l) => l.name === "Junior School")?.positions).toBe(false);
    expect(s.levels.find((l) => l.name === "Primary")?.positions).toBe(false);
    expect(s.levels.find((l) => l.name === "8-4-4")?.positions).toBe(true);
  });
});

describe("mark entry", () => {
  it("teachers enter marks only for their own assignments", async () => {
    const f = A;
    const [s1] = f.students;
    // The English teacher's own sheet: fine.
    const ok = await saveMarks(deps, f.english.actor, {
      ...sheet(f, f.eng.id),
      entries: [{ studentId: s1.id, assessmentId: f.cat.id, value: "21" }],
    });
    expect(ok.saved).toBe(1);
    // Maths is Kevin's: refused by the service...
    await expect(
      saveMarks(deps, f.english.actor, {
        ...sheet(f, f.math.id),
        entries: [{ studentId: s1.id, assessmentId: f.cat.id, value: "21" }],
      }),
    ).rejects.toThrow(ForbiddenError);
    // ...and by the database, even writing directly.
    await expect(
      withContext(appUnguarded, { userId: f.english.user.id, schoolId: f.school.id }, (tx) =>
        tx.mark.create({
          data: {
            schoolId: f.school.id,
            assessmentId: f.cat.id,
            subjectId: f.math.id,
            streamId: f.east.id,
            studentId: s1.id,
            status: "score",
            scoreTenths: 100,
            enteredById: f.english.user.id,
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    // A teacher's list shows only their own sheets.
    const mine = await myMarkSheets(deps, f.english.actor, f.term.id);
    expect(mine.map((m) => `${m.stream} ${m.subject}`)).toEqual([
      "Grade 7 East English",
      "Grade 7 West English",
    ]);
  });

  it("refuses marks above the maximum, here and in the database", async () => {
    const f = A;
    const r = await saveMarks(deps, f.english.actor, {
      ...sheet(f, f.eng.id),
      entries: [{ studentId: f.students[1].id, assessmentId: f.cat.id, value: "31" }],
    });
    expect(r.saved).toBe(0);
    expect(r.errors[0].message).toBe("Above 30");
    await expect(
      withContext(app, { userId: f.english.user.id, schoolId: f.school.id }, (tx) =>
        tx.mark.create({
          data: {
            schoolId: f.school.id,
            assessmentId: f.cat.id,
            subjectId: f.eng.id,
            streamId: f.east.id,
            studentId: f.students[1].id,
            status: "score",
            scoreTenths: 310,
            enteredById: f.english.user.id,
          },
        }),
      ),
    ).rejects.toThrow(/above the maximum/);
  });

  it("a subject teacher sees names on the sheet but never reads student records", async () => {
    const f = A;
    const s = await markSheet(deps, f.english.actor, sheet(f, f.eng.id));
    expect(s?.students.map((x) => x.firstName)).toEqual(["Amani", "Baraka", "Chausiku"]);
    const direct = await withContext(
      app,
      { userId: f.english.user.id, schoolId: f.school.id },
      (tx) => tx.student.findMany({ where: { schoolId: f.school.id } }),
    );
    expect(direct).toEqual([]);
  });

  it("uploads a filled Excel template", async () => {
    const f = A;
    const t = await markTemplate(deps, f.english.actor, {
      ...sheet(f, f.eng.id, f.west.id),
      assessmentId: f.cat.id,
    });
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Marks")!;
    expect(ws.getRow(1).getCell(3).value).toBe("Mark (out of 30)");
    ws.getRow(2).getCell(3).value = "A";
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await uploadMarks(deps, f.english.actor, {
      ...sheet(f, f.eng.id, f.west.id),
      assessmentId: f.cat.id,
      bytes: filled,
    });
    expect(r.saved).toBe(1);
    const m = await owner.mark.findFirstOrThrow({ where: { studentId: f.westStudent.id } });
    expect(m.status).toBe("absent");
    expect(m.scoreTenths).toBeNull();
  });
});

describe("results and sign-off", () => {
  it("leaves Absent and Exempt out of averages, never counting them as zero", async () => {
    const f = A;
    // Amani: English CAT 21/30 (70%), End 80 → 77; Maths absent for CAT, End 60 → 60.
    // Baraka: English 30/30, 90 → 93; Maths exempt in both → no Maths result.
    // Chausiku: English 15/30, 50 → 50; Maths 15/30, 40 → 43.
    await fillSheet(f, f.english.actor, f.eng.id, [
      ["21", "80"],
      ["30", "90"],
      ["15", "50"],
    ]);
    await fillSheet(f, f.maths.actor, f.math.id, [
      ["A", "60"],
      ["X", "X"],
      ["15", "40"],
    ]);
    const r = await streamResults(deps, f.classTeacher.actor, f.term.id, f.east.id);
    const by = (n: string) => r.students.find((s) => s.firstName === n)!;
    expect(by("Amani").subjects[f.eng.id]).toMatchObject({ pctTenths: 770, code: "EE2" });
    expect(by("Amani").subjects[f.math.id]).toMatchObject({ pctTenths: 600, code: "ME1" });
    expect(by("Baraka").subjects[f.math.id]).toMatchObject({ pctTenths: null, status: "exempt" });
    expect(by("Baraka").summary).toMatchObject({ count: 1, meanTenths: 930, meanGrade: "EE1" });
    expect(by("Chausiku").summary).toMatchObject({ count: 2, totalTenths: 930, meanTenths: 465 });
    // Positions are off for the junior school.
    expect(r.showPositions).toBe(false);
    expect(by("Amani").streamPosition).toBeNull();
    expect(r.allComplete).toBe(true);
  });

  it("can switch positions on for a level", async () => {
    const f = A;
    await setLevelGrading(deps, f.director.actor, f.junior.id, { positions: "on" });
    const r = await streamResults(deps, f.director.actor, f.term.id, f.east.id);
    const by = (n: string) => r.students.find((s) => s.firstName === n)!;
    expect(by("Baraka").streamPosition).toBe(1);
    expect(by("Amani").streamPosition).toBe(2);
    expect(by("Chausiku").streamPosition).toBe(3);
    expect(by("Amani").classPosition).toBe(2); // West has no full results yet
    await setLevelGrading(deps, f.director.actor, f.junior.id, { positions: "default" });
  });

  it("locks marks at sign-off: only the Principal changes them, with a reason, audited", async () => {
    const f = A;
    // The subject teacher can't approve; only the class teacher signs off their stream.
    await expect(signOffResults(deps, f.english.actor, f.term.id, f.east.id)).rejects.toThrow(
      ForbiddenError,
    );
    await signOffResults(deps, f.classTeacher.actor, f.term.id, f.east.id);
    const amani = f.students[0];
    await expect(
      saveMarks(deps, f.english.actor, {
        ...sheet(f, f.eng.id),
        entries: [{ studentId: amani.id, assessmentId: f.end.id, value: "85" }],
      }),
    ).rejects.toThrow(/signed these marks off/);
    // The database refuses it too.
    await expect(
      withContext(app, { userId: f.english.user.id, schoolId: f.school.id }, (tx) =>
        tx.mark.updateMany({
          where: { schoolId: f.school.id, studentId: amani.id, subjectId: f.eng.id },
          data: { scoreTenths: 1 },
        }),
      ),
    ).resolves.toEqual({ count: 0 });
    // The Principal: a reason is required, then the change is logged with before and after.
    await expect(
      saveMarks(deps, f.principal.actor, {
        ...sheet(f, f.eng.id),
        entries: [{ studentId: amani.id, assessmentId: f.end.id, value: "85" }],
      }),
    ).rejects.toThrow(ValidationError);
    const r = await saveMarks(deps, f.principal.actor, {
      ...sheet(f, f.eng.id),
      entries: [{ studentId: amani.id, assessmentId: f.end.id, value: "85" }],
      reason: "Marking error on page 3",
    });
    expect(r.saved).toBe(1);
    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId: f.school.id, action: "marks.change_locked" },
    });
    expect(log.actorId).toBe(f.principal.user.id);
    expect(log.before).toMatchObject({ mark: "80", studentId: amani.id });
    expect(log.after).toMatchObject({ mark: "85", reason: "Marking error on page 3" });
  });

  it("a class teacher can't approve; the Principal approves and releases", async () => {
    const f = A;
    await expect(approveResults(deps, f.classTeacher.actor, f.term.id, f.east.id)).rejects.toThrow(
      ForbiddenError,
    );
    // Not even by writing the status directly.
    await expect(
      withContext(app, { userId: f.classTeacher.user.id, schoolId: f.school.id }, (tx) =>
        tx.streamResult.updateMany({
          where: { schoolId: f.school.id, streamId: f.east.id },
          data: { status: "approved" },
        }),
      ),
    ).rejects.toThrow(/Only results.approve/);
    await saveReportExtras(deps, f.classTeacher.actor, {
      termId: f.term.id,
      streamId: f.east.id,
      studentId: f.students[0].id,
      classTeacherComment: "A focused learner.",
    });
    await expect(
      saveReportExtras(deps, f.classTeacher.actor, {
        termId: f.term.id,
        streamId: f.east.id,
        studentId: f.students[0].id,
        principalComment: "Not mine to write",
      }),
    ).rejects.toThrow(ForbiddenError);
    await sendBackResults(deps, f.dos.actor, f.term.id, f.east.id, "Check Maths");
    await signOffResults(deps, f.classTeacher.actor, f.term.id, f.east.id);
    await approveResults(deps, f.dos.actor, f.term.id, f.east.id);
    expect(await releaseResults(deps, f.principal.actor, f.term.id, f.east.id)).toBe(3);
    const r = await streamResults(deps, f.principal.actor, f.term.id, f.east.id);
    expect(r.status).toBe("released");
    const actions = (
      await owner.auditLog.findMany({
        where: { schoolId: f.school.id, action: { startsWith: "results." } },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "results.signoff",
      "results.send_back",
      "results.signoff",
      "results.approve",
      "results.release",
    ]);
  });

  it("prints a stream's report cards as one PDF in admission-number order", async () => {
    const f = A;
    const bundle = await reportCards(deps, f.classTeacher.actor, {
      termId: f.term.id,
      streamId: f.east.id,
      withImages: true,
    });
    expect(bundle.cards.map((c) => c.admissionNumber)).toEqual(["Ac/1", "Ac/2", "Ac/3"]);
    expect(bundle.cards[0].classTeacherComment).toBe("A focused learner.");
    expect(bundle.cards.every((c) => c.token)).toBe(true);
    const pdf = await reportCardsPdf(bundle);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    // A subject teacher can't print them.
    await expect(
      reportCards(deps, f.english.actor, { termId: f.term.id, streamId: f.east.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("the verification page reveals the school, name, term and release date only", async () => {
    const card = await owner.reportCard.findFirstOrThrow({ where: { schoolId: A.school.id } });
    const v = await verifyReportCard(app, card.token);
    expect(Object.keys(v!).sort()).toEqual(["releasedAt", "school", "student", "term"]);
    expect(v).toMatchObject({ school: A.school.name, term: "Term 3 2026" });
    expect(v!.student).toMatch(/ Test$/);
    expect(await verifyReportCard(app, "not-a-real-code-at-all-123")).toBeNull();
    expect(await verifyReportCard(app, "x' OR 1=1 --")).toBeNull();
  });
});

describe("school walls", () => {
  it("School B can never see School A's marks", async () => {
    const asB = { userId: B.director.user.id, schoolId: B.school.id };
    const seen = await withContext(appUnguarded, asB, (tx) => tx.mark.findMany());
    expect(seen.every((m) => m.schoolId === B.school.id)).toBe(true);
    const aMarks = await withContext(appUnguarded, asB, (tx) =>
      tx.mark.findMany({ where: { schoolId: A.school.id } }),
    );
    expect(aMarks).toEqual([]);
    // Naming School A's school while signed in as B's director sees nothing either.
    const forged = await withContext(
      appUnguarded,
      { userId: B.director.user.id, schoolId: A.school.id },
      (tx) => tx.mark.findMany(),
    );
    expect(forged).toEqual([]);
    await expect(streamResults(deps, B.director.actor, A.term.id, A.east.id)).rejects.toThrow();
  });
});
