/**
 * Helpers for database tests. Fixtures are created as the OWNER with unique phone numbers,
 * so test files never collide and nothing needs truncating.
 */
import { randomInt } from "node:crypto";
import { createAppClient, createClient } from "../src/lib/db-core";

export const owner = createClient(process.env.DATABASE_URL);
export const app = createAppClient();

export function randomPhone(): string {
  return `+2547${randomInt(10_000_000, 99_999_999)}`;
}

export async function makeSchool(name: string) {
  return owner.school.create({
    data: { name, shortName: name.slice(0, 11), county: "Kilifi", levelsOffered: ["primary"] },
  });
}

export async function makeMember(
  schoolId: string,
  roleKeys: string[] = ["director"],
  name = "Test",
) {
  const user = await owner.user.create({ data: { phone: randomPhone(), name } });
  const membership = await owner.membership.create({ data: { schoolId, userId: user.id } });
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
