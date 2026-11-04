/**
 * Import benchmark (npm run bench:import). Generates a 1,000-student / 1,600-guardian file,
 * then times reading, validating + preview, the all-or-nothing import, and a re-import, against
 * a fresh school in the `kiota_test` database (never your development data).
 * Writes the file to docs/samples/kiota-import-1000-students.xlsx.
 */
import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

loadEnv({ quiet: true });
const toTestDb = (url: string) => {
  const u = new URL(url);
  u.pathname = "/kiota_test";
  return u.toString();
};
process.env.DATABASE_URL = toTestDb(process.env.DATABASE_URL!);
process.env.APP_DATABASE_URL = toTestDb(process.env.APP_DATABASE_URL!);
process.env.LOCAL_STORAGE_DIR = ".storage-test";

const STUDENTS = 1000;
const GUARDIANS = 1600;

async function main() {
  const { createAppClient, createClient } = await import("../src/lib/db-core");
  const { BUILT_IN_ROLES } = await import("../src/lib/auth/catalog");
  const { effectivePermissions } = await import("../src/lib/auth/permissions");
  const { buildWorkbook, readWorkbook } = await import("../src/lib/import/workbook");
  const { previewImport, confirmImport } = await import("../src/lib/import/run");

  const owner = createClient(process.env.DATABASE_URL);
  const app = createAppClient();
  const time = async <T>(label: string, fn: () => Promise<T>) => {
    const t0 = performance.now();
    const r = await fn();
    const ms = performance.now() - t0;
    console.log(`${label.padEnd(44)} ${(ms / 1000).toFixed(2)} s`);
    return r;
  };

  // A fresh school with Primary and Junior School switched on.
  const school = await owner.school.create({
    data: { name: `Import benchmark ${Date.now()}`, shortName: "BENCH", county: "Kilifi" },
  });
  await owner.$executeRaw`SELECT kiota_copy_level_templates(${school.id}::uuid, ARRAY['primary','junior'])`;
  const user = await owner.user.create({
    data: { phone: `+2547${String(Date.now()).slice(-8)}`, name: "Bench Director" },
  });
  const m = await owner.membership.create({
    data: { schoolId: school.id, userId: user.id, displayName: "Bench Director" },
  });
  const director = await owner.role.findUniqueOrThrow({ where: { key: "director" } });
  await owner.membershipRole.create({
    data: { schoolId: school.id, membershipId: m.id, roleId: director.id },
  });
  const actor = {
    userId: user.id,
    schoolId: school.id,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === "director")!.permissions,
      grants: [],
    }),
  };

  // 6 classes x 3 streams; 1,000 students; 1,600 guardians (600 students have two).
  const classes = ["Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9"];
  const streams = ["East", "West", "North"];
  const first = [
    "Achieng",
    "Baraka",
    "Wanjiru",
    "Kamau",
    "Amina",
    "Otieno",
    "Zawadi",
    "Juma",
    "Neema",
    "Kibet",
  ];
  const last = [
    "Mwangi",
    "Odhiambo",
    "Kariuki",
    "Said",
    "Wekesa",
    "Mutua",
    "Chebet",
    "Barasa",
    "Njoroge",
    "Onyango",
  ];
  const studentRows: Record<string, string | null>[] = [];
  const guardianRows: Record<string, string>[] = [];
  for (let i = 0; i < STUDENTS; i++) {
    const cls = classes[i % classes.length];
    const adm = `PERF/${String(i + 1).padStart(4, "0")}`;
    studentRows.push({
      admissionNumber: adm,
      firstName: first[i % 10],
      lastName: `${last[(i * 7) % 10]}`,
      gender: i % 2 ? "Male" : "Female",
      dateOfBirth: `${2017 - classes.indexOf(cls)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
      class: cls,
      stream: streams[Math.floor(i / classes.length) % 3],
      boarding: i % 3 ? "Boarder" : "Day",
      house: ["Simba", "Chui", "Ndovu", "Twiga"][i % 4],
      openingBalance: i % 5 === 0 ? null : String(5_000 + (i % 40) * 750),
      medicalNotes: i % 25 === 0 ? "Asthma" : null,
    });
    guardianRows.push({
      admissionNumber: adm,
      name: `Mother ${i + 1}`,
      phone: `07${String(60_000_000 + i).padStart(8, "0")}`,
      relationship: "Mother",
    });
    if (guardianRows.length < GUARDIANS && i < GUARDIANS - STUDENTS) {
      guardianRows.push({
        admissionNumber: adm,
        name: `Father ${i + 1}`,
        phone: `+2547${String(61_000_000 + i).padStart(8, "0")}`,
        relationship: "Father",
      });
    }
  }
  const classRows = classes.flatMap((c) =>
    streams.map((s) => ({
      level: Number(c.split(" ")[1]) <= 6 ? "Primary" : "Junior School",
      class: c,
      stream: s,
    })),
  );

  console.log(
    `\n${STUDENTS} students, ${guardianRows.length} guardians, ${classRows.length} streams\n`,
  );
  const bytes = await time("Build the .xlsx file", () =>
    buildWorkbook(
      { levels: ["Primary", "Junior School"], classes },
      { Classes: classRows, Students: studentRows, Guardians: guardianRows },
    ),
  );
  const out = path.resolve("docs/samples/kiota-import-1000-students.xlsx");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, bytes);
  console.log(`  (${(bytes.length / 1024).toFixed(0)} KB, written to docs/samples)`);

  await time("Read the workbook only", () => readWorkbook(bytes));
  const preview = await time("Upload: read + validate + save preview", () =>
    previewImport({ db: app }, actor, { name: "kiota-import-1000-students.xlsx", bytes }),
  );
  console.log(`  counts: ${JSON.stringify(preview.plan.counts)}`);
  if (preview.plan.counts.errors > 0) {
    console.log(preview.plan.issues.slice(0, 5));
    throw new Error("The benchmark file should have no errors");
  }
  const summary = await time("Confirm: import everything (one transaction)", () =>
    confirmImport({ db: app }, actor, preview.batchId),
  );
  console.log(
    `  imported: ${summary.studentsNew} new students, ${summary.guardianRows} guardian links`,
  );

  const again = await time("Re-upload the same file (preview)", () =>
    previewImport({ db: app }, actor, { name: "again.xlsx", bytes }),
  );
  await time("Re-import the same file (all updates)", () =>
    confirmImport({ db: app }, actor, again.batchId),
  );

  const counts = await Promise.all([
    owner.student.count({ where: { schoolId: school.id } }),
    owner.guardianLink.count({ where: { schoolId: school.id } }),
    owner.openingBalance.count({ where: { schoolId: school.id } }),
  ]);
  console.log(
    `\nIn the database: ${counts[0]} students, ${counts[1]} guardian links, ${counts[2]} opening balances`,
  );
  console.log("Time limit for one import transaction: 180 s");
  await owner.$disconnect();
  await app.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
