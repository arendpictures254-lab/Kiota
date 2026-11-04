/**
 * Names never cross school walls: a school reads only the name IT typed for a staff member
 * (memberships.display_name) or guardian (guardian_links.name), never the platform-level
 * users.name another school may have typed. Enforced by column privileges in the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, withContext } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";
import { inviteStaff, listStaff } from "@/lib/staff/service";
import { addGuardian, getStudent } from "@/lib/students/service";
import {
  app,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../tests/db-helpers";

const deps = { db: app };
const director = effectivePermissions({
  rolePermissions: BUILT_IN_ROLES.find((r) => r.key === "director")!.permissions,
  grants: [],
});

let a: Actor;
let b: Actor;
const staffPhone = randomPhone();
const parentPhone = randomPhone();
let studentB: { id: string };

beforeAll(async () => {
  for (const [label, set] of [
    ["Names A", (x: Actor) => (a = x)],
    ["Names B", (x: Actor) => (b = x)],
  ] as const) {
    const school = await makeSchool(`${label} ${Date.now()}`);
    const d = await makeMember(school.id, ["director"]);
    set({ userId: d.user.id, schoolId: school.id, permissions: director });
  }
  // School A adds the teacher and the parent first, with A's spelling of their names.
  await inviteStaff(deps, a, {
    name: "Secret Name From A",
    phone: staffPhone,
    roleKeys: ["bursar"],
  });
  const streamA = await makeStream(a.schoolId, "Grade 7", "East");
  const studentA = await makeStudent(a.schoolId, streamA.id);
  await addGuardian(deps, a, studentA.id, {
    name: "Parent Name From A",
    phone: parentPhone,
    relationship: "mother",
    language: "en",
    receivesFees: true,
    receivesAcademics: true,
    receivesBoarding: true,
    authorisedToCollect: true,
  });
  // School B adds the same people with its own spelling.
  await inviteStaff(deps, b, {
    name: "Teacher As B Knows Them",
    phone: staffPhone,
    roleKeys: ["class_teacher"],
  });
  const streamB = await makeStream(b.schoolId, "Grade 8", "West");
  studentB = await makeStudent(b.schoolId, streamB.id);
  await addGuardian(deps, b, studentB.id, {
    name: "Mama B",
    phone: parentPhone,
    relationship: "mother",
    language: "sw",
    receivesFees: true,
    receivesAcademics: true,
    receivesBoarding: true,
    authorisedToCollect: true,
  });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("names across schools", () => {
  it("the platform keeps one identity per phone, named by whoever came first", async () => {
    expect((await owner.user.findUniqueOrThrow({ where: { phone: staffPhone } })).name).toBe(
      "Secret Name From A",
    );
    expect((await owner.user.findUniqueOrThrow({ where: { phone: parentPhone } })).name).toBe(
      "Parent Name From A",
    );
  });

  it("School B sees only its own names for staff and guardians", async () => {
    const staff = await listStaff(deps, b);
    expect(staff.map((s) => s.name)).toContain("Teacher As B Knows Them");
    expect(JSON.stringify(staff)).not.toContain("From A");

    const student = await getStudent(deps, b, studentB.id);
    expect(student?.guardians.map((g) => g.name)).toEqual(["Mama B"]);
    expect(JSON.stringify(student)).not.toContain("From A");
  });

  it("School B cannot read a name School A typed, even with direct or raw queries", async () => {
    const db = scopedDb(app, { userId: b.userId, schoolId: b.schoolId });
    await expect(db.$queryRaw`SELECT name FROM users WHERE phone = ${staffPhone}`).rejects.toThrow(
      /permission denied/i,
    );
    await expect(db.$queryRaw`SELECT * FROM users`).rejects.toThrow(/permission denied/i);
    await expect(db.user.findMany()).rejects.toThrow(/permission denied/i);
    await expect(db.user.findMany({ select: { name: true } })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(db.user.findMany({ select: { email: true } })).rejects.toThrow(
      /permission denied/i,
    );
    // Only the harmless columns are readable, and only for its own staff and guardians.
    const visible = await db.user.findMany({ select: { phone: true } });
    expect(visible.map((u) => u.phone)).toEqual(expect.arrayContaining([staffPhone, parentPhone]));
  });

  it("no school can change platform users", async () => {
    await expect(
      withContext(
        app,
        { userId: b.userId, schoolId: b.schoolId },
        (tx) => tx.$executeRaw`UPDATE users SET name = 'x' WHERE phone = ${staffPhone}`,
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a user can still read their own platform name through app_me()", async () => {
    const teacher = await owner.user.findUniqueOrThrow({ where: { phone: staffPhone } });
    const [me] = await scopedDb(app, { userId: teacher.id, schoolId: null }).$queryRaw<
      { name: string }[]
    >`SELECT name FROM app_me()`;
    expect(me.name).toBe("Secret Name From A");
    // ...and app_me() never returns anyone else.
    const none = await app.$queryRaw<unknown[]>`SELECT * FROM app_me()`;
    expect(none).toEqual([]);
  });
});
