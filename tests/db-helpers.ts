/**
 * Helpers for database tests. Fixtures are created as the OWNER with unique phone numbers,
 * so test files never collide and nothing needs truncating.
 */
import { randomInt } from "node:crypto";
import { createAppClient, createClient } from "../src/lib/db-core";

export const owner = createClient(process.env.DATABASE_URL);
export const app = createAppClient();
/**
 * The app role WITHOUT the school-wall guard (src/lib/db-guard.ts), for tests that leave out
 * schoolId on purpose to prove row-level security still blocks other schools.
 */
export const appUnguarded = createClient(process.env.APP_DATABASE_URL);

export function randomPhone(): string {
  return `+2547${randomInt(10_000_000, 99_999_999)}`;
}

/** A school with the Kenyan level templates copied in; `levels` are switched on. */
export async function makeSchool(name: string, levels: string[] = ["primary", "junior"]) {
  const school = await owner.school.create({
    data: { name, shortName: name.slice(0, 11), county: "Kilifi" },
  });
  await owner.$executeRaw`SELECT kiota_copy_level_templates(${school.id}::uuid, ${levels}::text[])`;
  return school;
}

/** Create a stream in `className` (e.g. "Grade 7") at a school. */
export async function makeStream(schoolId: string, className: string, name: string) {
  const cls = await owner.class.findUniqueOrThrow({
    where: { schoolId_name: { schoolId, name: className } },
  });
  return owner.stream.create({ data: { schoolId, classId: cls.id, name } });
}

let admissionSeq = 0;
export async function makeStudent(
  schoolId: string,
  streamId: string,
  data: Partial<{ firstName: string; lastName: string; admissionNumber: string }> = {},
) {
  const stream = await owner.stream.findUniqueOrThrow({ where: { id: streamId } });
  return owner.student.create({
    data: {
      schoolId,
      admissionNumber: data.admissionNumber ?? `T${Date.now()}${admissionSeq++}`,
      firstName: data.firstName ?? "Test",
      lastName: data.lastName ?? "Student",
      gender: "female",
      dateOfBirth: new Date("2013-05-01"),
      classId: stream.classId,
      streamId,
    },
  });
}

export async function makeMember(
  schoolId: string,
  roleKeys: string[] = ["director"],
  name = "Test",
) {
  const user = await owner.user.create({ data: { phone: randomPhone(), name } });
  const membership = await owner.membership.create({
    data: { schoolId, userId: user.id, displayName: name },
  });
  for (const key of roleKeys) {
    const role = await owner.role.findUniqueOrThrow({ where: { key } });
    await owner.membershipRole.create({
      data: { schoolId, membershipId: membership.id, roleId: role.id },
    });
  }
  return { user, membership };
}

export async function makeAdmin() {
  return owner.user.create({
    data: { phone: randomPhone(), name: "Arend Admin", isPlatformAdmin: true },
  });
}
