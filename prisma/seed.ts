/**
 * Development seed (runs as the database owner): npx prisma db seed
 * Idempotent: safe to run again. Test phone numbers are listed in README.md.
 */
import "dotenv/config";
import { createClient } from "../src/lib/db-core";
import { seedStudents } from "./seed-students";
import { enableAppRoleLogin, syncCatalog } from "./setup";

export const SEED = {
  arendAdmin: { phone: "+254700000001", name: "Arend Admin" },
  schools: [
    {
      name: "Bahari Academy",
      shortName: "BAHARI",
      county: "Kilifi",
      levelsOffered: ["primary", "junior"],
      staff: [
        { phone: "+254711000001", name: "Amina Said", roles: ["director"] },
        { phone: "+254711000002", name: "Peter Otieno", roles: ["bursar"] },
        { phone: "+254711000003", name: "Grace Wanjiru", roles: ["class_teacher"] },
      ],
    },
    {
      name: "Milima School",
      shortName: "MILIMA",
      county: "Nyeri",
      levelsOffered: ["junior", "senior"],
      staff: [
        { phone: "+254722000001", name: "John Kamau", roles: ["director"] },
        { phone: "+254722000002", name: "Mary Achieng", roles: ["bursar"] },
        { phone: "+254722000003", name: "David Kiprono", roles: ["class_teacher"] },
      ],
    },
  ],
  /** Works at both schools, so sees the school picker. */
  sharedTeacher: {
    phone: "+254733000001",
    name: "Faith Njeri",
    memberships: [
      { school: "Bahari Academy", roles: ["subject_teacher"] },
      { school: "Milima School", roles: ["subject_teacher"] },
    ],
  },
} as const;

async function main() {
  const owner = createClient(process.env.DATABASE_URL);
  try {
    await enableAppRoleLogin(owner, process.env.APP_DATABASE_URL ?? "");
    await syncCatalog(owner);

    const roleIds = new Map(
      (await owner.role.findMany({ where: { schoolId: null } })).map((r) => [r.key!, r.id]),
    );

    async function ensureUser(phone: string, name: string, isPlatformAdmin = false) {
      return owner.user.upsert({
        where: { phone },
        create: { phone, name, isPlatformAdmin },
        update: { name, isPlatformAdmin },
      });
    }

    async function ensureMember(schoolId: string, userId: string, roles: readonly string[]) {
      const membership = await owner.membership.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { schoolId, userId },
        update: { status: "active" },
      });
      for (const key of roles) {
        const roleId = roleIds.get(key);
        if (!roleId) throw new Error(`Unknown role ${key}`);
        await owner.membershipRole.upsert({
          where: { membershipId_roleId: { membershipId: membership.id, roleId } },
          create: { schoolId, membershipId: membership.id, roleId },
          update: {},
        });
      }
    }

    await ensureUser(SEED.arendAdmin.phone, SEED.arendAdmin.name, true);

    const schoolIds = new Map<string, string>();
    for (const s of SEED.schools) {
      const existing = await owner.school.findFirst({ where: { name: s.name } });
      const school =
        existing ??
        (await owner.school.create({
          data: { name: s.name, shortName: s.shortName, county: s.county },
        }));
      // Kenyan level defaults; switches on the levels this school offers.
      await owner.$executeRaw`SELECT kiota_copy_level_templates(${school.id}::uuid, ${[...s.levelsOffered]}::text[])`;
      schoolIds.set(s.name, school.id);
      for (const person of s.staff) {
        const user = await ensureUser(person.phone, person.name);
        await ensureMember(school.id, user.id, person.roles);
      }
    }

    const shared = await ensureUser(SEED.sharedTeacher.phone, SEED.sharedTeacher.name);
    for (const m of SEED.sharedTeacher.memberships) {
      await ensureMember(schoolIds.get(m.school)!, shared.id, m.roles);
    }

    await seedStudents(owner, schoolIds);

    console.log("Seeded Bahari Academy, Milima School, their students and the Arend admin.");
  } finally {
    await owner.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main as seed };
