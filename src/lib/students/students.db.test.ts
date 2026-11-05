import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, withContext } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  appUnguarded,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import { previewPromotion, promoteClass } from "./promotion";
import {
  changeStudentStatus,
  createStudent,
  getStudent,
  listStudents,
  parseGuardianInput,
  parseStudentInput,
  updateStudent,
} from "./service";

const deps = { db: app };
const perms = (role: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
    grants: [],
  });

let schoolId: string;
let east: { id: string; classId: string };
let west: { id: string };
let director: Actor;
let bursar: Actor;
let teacher: Actor;
let eastStudent: { id: string };
let westStudent: { id: string };

beforeAll(async () => {
  schoolId = (await makeSchool(`Students ${Date.now()}`)).id;
  east = await makeStream(schoolId, "Grade 7", "East");
  west = await makeStream(schoolId, "Grade 7", "West");
  const d = await makeMember(schoolId, ["director"]);
  const b = await makeMember(schoolId, ["bursar"]);
  const t = await makeMember(schoolId, ["class_teacher"]);
  director = { userId: d.user.id, schoolId, permissions: perms("director") };
  bursar = { userId: b.user.id, schoolId, permissions: perms("bursar") };
  teacher = { userId: t.user.id, schoolId, permissions: perms("class_teacher") };
  await owner.stream.update({
    where: { id: east.id },
    data: { classTeacherMembershipId: t.membership.id },
  });

  const created = await createStudent(
    deps,
    director,
    parseStudentInput({
      admissionNumber: `S-${Date.now()}`,
      firstName: "Zawadi",
      lastName: "Mwangi",
      gender: "female",
      dateOfBirth: "2014-02-02",
      classId: east.classId,
      streamId: east.id,
      boarding: "boarder",
      medicalNotes: "Epilepsy",
      allergies: "Penicillin",
    }),
    [parseGuardianInput({ name: "Ruth Mwangi", phone: randomPhone(), relationship: "mother" })],
  );
  eastStudent = { id: created.studentId };
  westStudent = await makeStudent(schoolId, west.id, { firstName: "Baraka", lastName: "Kiprop" });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("medical notes", () => {
  it("are visible to the Director", async () => {
    const s = await getStudent(deps, director, eastStudent.id);
    expect(s?.medical).toMatchObject({ medicalNotes: "Epilepsy", allergies: "Penicillin" });
  });

  it("are hidden from a Bursar, even through direct and raw queries", async () => {
    const s = await getStudent(deps, bursar, eastStudent.id);
    expect(s?.firstName).toBe("Zawadi");
    expect(s?.medical).toBeNull();
    const db = scopedDb(appUnguarded, { userId: bursar.userId, schoolId });
    expect(await db.studentMedical.findMany()).toEqual([]);
    expect(await db.$queryRaw<unknown[]>`SELECT * FROM student_medical`).toEqual([]);
    // ...and cannot be written either.
    await expect(
      withContext(app, { userId: bursar.userId, schoolId }, (tx) =>
        tx.studentMedical.create({ data: { schoolId, studentId: westStudent.id, allergies: "x" } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("are never copied into the audit log", async () => {
    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId, action: "student.create", targetId: eastStudent.id },
    });
    expect(JSON.stringify(log.after)).not.toContain("Epilepsy");
  });
});

describe("class teachers", () => {
  it("see only the students in their own streams", async () => {
    const { students, total } = await listStudents(deps, teacher, { status: "all" });
    expect(total).toBe(1);
    expect(students[0].id).toBe(eastStudent.id);
    expect(await getStudent(deps, teacher, westStudent.id)).toBeNull();
    const raw = await scopedDb(app, { userId: teacher.userId, schoolId }).$queryRaw<unknown[]>`
      SELECT id FROM students WHERE id = ${westStudent.id}::uuid`;
    expect(raw).toEqual([]);
  });

  it("cannot read the guardians or change students of other streams", async () => {
    const db = scopedDb(appUnguarded, { userId: teacher.userId, schoolId });
    expect(await db.guardianLink.findMany({ where: { studentId: westStudent.id } })).toEqual([]);
    const updated = await withContext(appUnguarded, { userId: teacher.userId, schoolId }, (tx) =>
      tx.student.updateMany({ where: { id: westStudent.id }, data: { firstName: "Changed" } }),
    );
    expect(updated.count).toBe(0);
  });

  it("cannot edit students (no students.edit)", async () => {
    await expect(
      changeStudentStatus(deps, teacher, eastStudent.id, {
        status: "suspended",
        date: "2026-11-01",
        reason: "x",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("editing", () => {
  it("records before and after in the audit log", async () => {
    const before = await owner.student.findUniqueOrThrow({ where: { id: westStudent.id } });
    await updateStudent(
      deps,
      director,
      westStudent.id,
      parseStudentInput({
        admissionNumber: before.admissionNumber,
        firstName: "Baraka",
        middleName: "Kip",
        lastName: "Kiprop",
        gender: "male",
        dateOfBirth: "2013-07-07",
        classId: east.classId,
        streamId: west.id,
        boarding: "day",
      }),
    );
    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId, action: "student.update", targetId: westStudent.id },
    });
    expect(log.before).toMatchObject({ middleName: null, gender: "female" });
    expect(log.after).toMatchObject({ middleName: "Kip", gender: "male", boarder: false });
  });

  it("archives with a status and history; students can never be deleted", async () => {
    await changeStudentStatus(deps, director, westStudent.id, {
      status: "transferred",
      date: "2026-11-02",
      reason: "Moved to Nakuru",
    });
    const s = await owner.student.findUniqueOrThrow({
      where: { id: westStudent.id },
      include: { statusChanges: true },
    });
    expect(s.status).toBe("transferred");
    expect(s.statusChanges.at(-1)).toMatchObject({
      fromStatus: "active",
      toStatus: "transferred",
      reason: "Moved to Nakuru",
    });
    await expect(
      withContext(app, { userId: director.userId, schoolId }, (tx) =>
        tx.student.delete({ where: { id: westStudent.id } }),
      ),
    ).rejects.toThrow();
    await expect(owner.student.delete({ where: { id: westStudent.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      owner.studentStatusChange.deleteMany({ where: { studentId: westStudent.id } }),
    ).rejects.toThrow(/append-only/);
    // Back to active for other tests.
    await changeStudentStatus(deps, director, westStudent.id, {
      status: "active",
      date: "2026-11-03",
      reason: "Returned",
    });
  });

  it("rejects a duplicate admission number", async () => {
    const existing = await owner.student.findUniqueOrThrow({ where: { id: eastStudent.id } });
    await expect(
      createStudent(
        deps,
        director,
        parseStudentInput({
          admissionNumber: existing.admissionNumber,
          firstName: "A",
          lastName: "B",
          gender: "male",
          dateOfBirth: "2014-01-01",
          classId: east.classId,
          streamId: east.id,
          boarding: "day",
        }),
        [],
      ),
    ).rejects.toThrow(/already used/);
  });
});

describe("promotion", () => {
  it("previews, then moves a whole class up keeping streams", async () => {
    const school = (await makeSchool(`Promo ${Date.now()}`)).id;
    const g7e = await makeStream(school, "Grade 7", "East");
    const g7w = await makeStream(school, "Grade 7", "West");
    for (let i = 0; i < 3; i++) await makeStudent(school, g7e.id);
    await makeStudent(school, g7w.id);
    const d = await makeMember(school, ["director"]);
    const actor: Actor = { userId: d.user.id, schoolId: school, permissions: perms("director") };

    const plan = await previewPromotion(deps, actor, g7e.classId);
    expect(plan.toClass?.name).toBe("Grade 8");
    expect(plan.total).toBe(4);
    expect(plan.moves).toEqual([
      { fromStream: "East", toStream: "East", createStream: true, count: 3 },
      { fromStream: "West", toStream: "West", createStream: true, count: 1 },
    ]);
    expect(
      await owner.student.count({ where: { schoolId: school, class: { name: "Grade 8" } } }),
    ).toBe(0);

    await promoteClass(deps, actor, g7e.classId);
    const moved = await owner.student.findMany({
      where: { schoolId: school },
      include: { class: true, stream: true },
    });
    expect(moved.every((s) => s.class.name === "Grade 8")).toBe(true);
    expect(moved.filter((s) => s.stream?.name === "East")).toHaveLength(3);
  });

  it("graduates the last class when the school has no next level", async () => {
    const school = (await makeSchool(`Grad ${Date.now()}`, ["junior"])).id;
    const g9 = await makeStream(school, "Grade 9", "North");
    await makeStudent(school, g9.id);
    const d = await makeMember(school, ["director"]);
    const actor: Actor = { userId: d.user.id, schoolId: school, permissions: perms("director") };
    const plan = await previewPromotion(deps, actor, g9.classId);
    expect(plan.toClass).toBeNull();
    await promoteClass(deps, actor, g9.classId);
    const s = await owner.student.findFirstOrThrow({
      where: { schoolId: school },
      include: { statusChanges: true },
    });
    expect(s.status).toBe("graduated");
    expect(s.statusChanges.at(-1)?.reason).toMatch(/Completed Grade 9/);
  });

  it("refuses to mix two years in one class", async () => {
    const school = (await makeSchool(`Mix ${Date.now()}`)).id;
    const g7 = await makeStream(school, "Grade 7", "East");
    const g8 = await makeStream(school, "Grade 8", "East");
    await makeStudent(school, g7.id);
    await makeStudent(school, g8.id);
    const d = await makeMember(school, ["director"]);
    const actor: Actor = { userId: d.user.id, schoolId: school, permissions: perms("director") };
    const plan = await previewPromotion(deps, actor, g7.classId);
    expect(plan.warnings[0]).toMatch(/Promote Grade 8 first/);
    await expect(promoteClass(deps, actor, g7.classId)).rejects.toThrow(/Promote Grade 8 first/);
  });
});
