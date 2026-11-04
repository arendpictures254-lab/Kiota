import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  makeMember,
  makeSchool,
  makeStream,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import { confirmImport, previewImport } from "./run";
import { buildWorkbook, type CellValue } from "./workbook";

process.env.LOCAL_STORAGE_DIR = ".storage-test";

const deps = { db: app };
const directorPerms = effectivePermissions({
  rolePermissions: BUILT_IN_ROLES.find((r) => r.key === "director")!.permissions,
  grants: [],
});

async function schoolWithDirector(name: string) {
  const school = await makeSchool(`${name} ${Date.now()}`);
  await makeStream(school.id, "Grade 7", "East");
  const d = await makeMember(school.id, ["director"]);
  const actor: Actor = { userId: d.user.id, schoolId: school.id, permissions: directorPerms };
  return { school, actor };
}

const lists = { levels: ["Primary", "Junior School"], classes: ["Grade 7", "Grade 8"] };

function studentRow(admissionNumber: string, over: Record<string, CellValue> = {}) {
  return {
    admissionNumber,
    firstName: "Achieng",
    lastName: `Otieno ${admissionNumber}`,
    gender: "Female",
    dateOfBirth: "2014-03-14",
    class: "Grade 7",
    stream: "East",
    boarding: "Boarder",
    openingBalance: "12,500",
    ...over,
  };
}

async function upload(
  actor: Actor,
  fill: Parameters<typeof buildWorkbook>[1],
  name = "students.xlsx",
) {
  return previewImport(deps, actor, { name, bytes: await buildWorkbook(lists, fill) });
}

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("preview", () => {
  it("saves nothing but the upload until confirmed", async () => {
    const { school, actor } = await schoolWithDirector("Preview");
    const { plan } = await upload(actor, {
      Students: [studentRow("P-1")],
      Guardians: [
        { admissionNumber: "P-1", name: "Mary", phone: randomPhone(), relationship: "Mother" },
      ],
    });
    expect(plan.counts).toMatchObject({ studentsNew: 1, errors: 0 });
    expect(await owner.student.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await owner.guardianLink.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await owner.importBatch.count({ where: { schoolId: school.id } })).toBe(1);
  });

  it("refuses to import a file with errors", async () => {
    const { school, actor } = await schoolWithDirector("Errors");
    const { batchId, plan } = await upload(actor, {
      Students: [studentRow("E-1"), studentRow("E-2", { stream: "Nowhere" })],
    });
    expect(plan.counts.errors).toBe(1);
    await expect(confirmImport(deps, actor, batchId)).rejects.toThrow(/1 problem to fix first/);
    expect(await owner.student.count({ where: { schoolId: school.id } })).toBe(0);
  });
});

describe("confirm", () => {
  it("imports students, guardians, streams, houses and opening balances, and audits it", async () => {
    const { school, actor } = await schoolWithDirector("Import");
    const phone = randomPhone();
    const { batchId } = await upload(
      actor,
      {
        Classes: [{ level: "Junior School", class: "Grade 8", stream: "Blue" }],
        Students: [
          studentRow("I-1", { house: "Simba", medicalNotes: "Asthma", allergies: "Peanuts" }),
          studentRow("I-2", {
            class: "Grade 8",
            stream: "Blue",
            boarding: "Day",
            openingBalance: "-500",
          }),
        ],
        Guardians: [
          { admissionNumber: "I-1", name: "Mary Otieno", phone, relationship: "Mother" },
          { admissionNumber: "I-2", name: "Mary Otieno", phone, relationship: "Mother" },
        ],
      },
      "december.xlsx",
    );
    const summary = await confirmImport(deps, actor, batchId);
    expect(summary).toMatchObject({
      studentsNew: 2,
      guardianRows: 2,
      streamsNew: 1,
      housesNew: 1,
      openingBalances: 2,
    });

    const students = await owner.student.findMany({
      where: { schoolId: school.id },
      include: {
        stream: true,
        house: true,
        guardians: true,
        medical: true,
        openingBalance: true,
        statusChanges: true,
      },
      orderBy: { admissionNumber: "asc" },
    });
    expect(students).toHaveLength(2);
    expect(students[0]).toMatchObject({
      boarder: true,
      house: { name: "Simba" },
      medical: { medicalNotes: "Asthma", allergies: "Peanuts" },
    });
    expect(students[0].openingBalance).toMatchObject({
      amountCents: 1_250_000,
      posted: false,
      source: "december.xlsx",
    });
    expect(students[1]).toMatchObject({ boarder: false, stream: { name: "Blue" } });
    expect(students[1].openingBalance!.amountCents).toBe(-50_000);
    expect(students[0].statusChanges[0]).toMatchObject({ toStatus: "active" });

    // One parent, one platform identity, two links.
    expect(await owner.user.count({ where: { phone } })).toBe(1);
    expect(students[0].guardians[0].userId).toBe(students[1].guardians[0].userId);

    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId: school.id, action: "students.import" },
    });
    expect(log.actorId).toBe(actor.userId);
    expect(log.after).toMatchObject({
      fileName: "december.xlsx",
      studentsNew: 2,
      rows: { students: 2, guardians: 2 },
    });

    await expect(confirmImport(deps, actor, batchId)).rejects.toThrow(/already been imported/);
  });

  it("is all or nothing: a failure part-way leaves no students behind", async () => {
    const { school, actor } = await schoolWithDirector("Atomic");
    const badPhone = randomPhone();
    // Make the database reject the LAST guardian row, after students were already written.
    await owner.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_guardian() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND phone = '${badPhone}') THEN
          RAISE EXCEPTION 'simulated failure';
        END IF;
        RETURN NEW;
      END $$;`);
    await owner.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_guardian BEFORE INSERT ON guardian_links FOR EACH ROW EXECUTE FUNCTION test_fail_guardian()`,
    );
    try {
      const { batchId } = await upload(actor, {
        Students: [studentRow("T-1"), studentRow("T-2"), studentRow("T-3")],
        Guardians: [
          { admissionNumber: "T-1", name: "A", phone: randomPhone(), relationship: "Mother" },
          { admissionNumber: "T-2", name: "B", phone: randomPhone(), relationship: "Mother" },
          { admissionNumber: "T-3", name: "C", phone: badPhone, relationship: "Mother" },
        ],
      });
      await expect(confirmImport(deps, actor, batchId)).rejects.toThrow(/simulated failure/);
    } finally {
      await owner.$executeRawUnsafe(`DROP TRIGGER test_fail_guardian ON guardian_links`);
      await owner.$executeRawUnsafe(`DROP FUNCTION test_fail_guardian()`);
    }
    expect(await owner.student.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await owner.guardianLink.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await owner.openingBalance.count({ where: { schoolId: school.id } })).toBe(0);
    expect(
      await owner.auditLog.count({ where: { schoolId: school.id, action: "students.import" } }),
    ).toBe(0);
  });

  it("re-importing the same file creates no duplicates", async () => {
    const { school, actor } = await schoolWithDirector("Rerun");
    const fill = {
      Students: [studentRow("R-1"), studentRow("R-2")],
      Guardians: [
        { admissionNumber: "R-1", name: "Mary", phone: randomPhone(), relationship: "Mother" },
        { admissionNumber: "R-2", name: "Jane", phone: randomPhone(), relationship: "Guardian" },
      ],
    };
    await confirmImport(deps, actor, (await upload(actor, fill)).batchId);
    const second = await upload(actor, fill);
    expect(second.plan.counts).toMatchObject({ studentsNew: 0, studentsUpdated: 2, errors: 0 });
    await confirmImport(deps, actor, second.batchId);

    expect(await owner.student.count({ where: { schoolId: school.id } })).toBe(2);
    expect(await owner.guardianLink.count({ where: { schoolId: school.id } })).toBe(2);
    expect(await owner.openingBalance.count({ where: { schoolId: school.id } })).toBe(2);
    expect(await owner.studentStatusChange.count({ where: { schoolId: school.id } })).toBe(2);
  });

  it("never changes an opening balance the fees module has posted", async () => {
    const { school, actor } = await schoolWithDirector("Posted");
    await confirmImport(
      deps,
      actor,
      (await upload(actor, { Students: [studentRow("OB-1")] })).batchId,
    );
    const s = await owner.student.findFirstOrThrow({ where: { schoolId: school.id } });
    await owner.openingBalance.update({ where: { studentId: s.id }, data: { posted: true } });

    const again = await upload(actor, { Students: [studentRow("OB-1", { openingBalance: "99" })] });
    expect(again.plan.issues.some((i) => /already in the fees ledger/.test(i.message))).toBe(true);
    await confirmImport(deps, actor, again.batchId);
    expect(
      (await owner.openingBalance.findUniqueOrThrow({ where: { studentId: s.id } })).amountCents,
    ).toBe(1_250_000);
    await expect(
      owner.openingBalance.update({ where: { studentId: s.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/posted opening balances cannot change/);
  });
});

describe("guardians across schools", () => {
  let parentPhone: string;
  let a: Awaited<ReturnType<typeof schoolWithDirector>>;
  let b: Awaited<ReturnType<typeof schoolWithDirector>>;

  beforeAll(async () => {
    parentPhone = randomPhone();
    a = await schoolWithDirector("Pwani");
    b = await schoolWithDirector("Mlima");
    await confirmImport(
      deps,
      a.actor,
      (
        await upload(a.actor, {
          Students: [studentRow("A-1"), studentRow("A-2")],
          Guardians: [
            {
              admissionNumber: "A-1",
              name: "Wanjiku Kamau",
              phone: parentPhone,
              relationship: "Mother",
            },
            {
              admissionNumber: "A-2",
              name: "Wanjiku Kamau",
              phone: parentPhone,
              relationship: "Mother",
            },
          ],
        })
      ).batchId,
    );
    await confirmImport(
      deps,
      b.actor,
      (
        await upload(b.actor, {
          Students: [studentRow("B-1")],
          Guardians: [
            {
              admissionNumber: "B-1",
              name: "Mama Brian",
              phone: parentPhone,
              relationship: "Mother",
            },
          ],
        })
      ).batchId,
    );
  });

  it("links the same platform user, never a duplicate", async () => {
    expect(await owner.user.count({ where: { phone: parentPhone } })).toBe(1);
    const links = await owner.guardianLink.findMany({ where: { user: { phone: parentPhone } } });
    expect(links).toHaveLength(3);
    expect(new Set(links.map((l) => l.userId)).size).toBe(1);
  });

  it("confirms links within the first school immediately and marks the other school's link pending", async () => {
    const links = await owner.guardianLink.findMany({
      where: { user: { phone: parentPhone } },
      include: { confirmation: true },
    });
    const atA = links.filter((l) => l.schoolId === a.school.id);
    const atB = links.filter((l) => l.schoolId === b.school.id);
    expect(atA.every((l) => l.confirmation === null)).toBe(true);
    expect(atB[0].confirmation).toMatchObject({ status: "pending" });
  });

  it("never lets a school see the parent's other schools", async () => {
    const dbB = scopedDb(app, { userId: b.actor.userId, schoolId: b.school.id });
    const links = await dbB.guardianLink.findMany();
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe("Mama Brian"); // the school's own name for the parent
    expect(await dbB.parentLinkConfirmation.findMany()).toEqual([]);
    expect(await dbB.$queryRaw<unknown[]>`SELECT * FROM parent_link_confirmations`).toEqual([]);
    expect(await dbB.guardianLink.count({ where: { schoolId: a.school.id } })).toBe(0);
    expect(await dbB.student.count({ where: { schoolId: a.school.id } })).toBe(0);
  });

  it("lets only the parent see their pending confirmation", async () => {
    const parent = await owner.user.findUniqueOrThrow({ where: { phone: parentPhone } });
    const mine = await scopedDb(app, {
      userId: parent.id,
      schoolId: null,
    }).parentLinkConfirmation.findMany();
    expect(mine).toHaveLength(1);
  });
});
