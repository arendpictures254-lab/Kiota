/**
 * The import flow: upload -> preview (nothing saved but the parsed file) -> confirm.
 * Confirm re-validates against the current data and imports everything in ONE transaction:
 * all or nothing. Re-importing a file updates students by admission number, so it never
 * creates duplicates.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";
import { getStorage, schoolKey } from "@/lib/storage";
import { linkGuardian } from "@/lib/students/service";
import { type ImportContext, type ImportPlan, admissionKey, validateImport } from "./validate";
import { type ReadProblem, type SheetRows, readWorkbook } from "./workbook";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type Payload = { sheets: SheetRows; problems: ReadProblem[] };

export async function loadImportContext(tx: Tx, actor: Actor): Promise<ImportContext> {
  const [levels, houses, staff, students] = await Promise.all([
    tx.level.findMany({
      orderBy: { sortOrder: "asc" },
      include: { classes: { orderBy: { position: "asc" }, include: { streams: true } } },
    }),
    tx.house.findMany(),
    tx.membership.findMany({ where: { status: "active" }, include: { user: true } }),
    tx.student.findMany({
      select: {
        admissionNumber: true,
        firstName: true,
        lastName: true,
        openingBalance: { select: { posted: true } },
        _count: { select: { guardians: true } },
      },
    }),
  ]);
  return {
    levels: levels.map((l) => ({
      key: l.key,
      name: l.name,
      enabled: l.enabled,
      classes: l.classes.map((c) => ({ name: c.name, streams: c.streams.map((s) => s.name) })),
    })),
    houses: houses.map((h) => h.name),
    staffPhones: new Map(staff.map((m) => [m.user.phone, m.id])),
    existingStudents: new Map(
      students.map((s) => [
        admissionKey(s.admissionNumber),
        {
          admissionNumber: s.admissionNumber,
          firstName: s.firstName,
          lastName: s.lastName,
          guardianCount: s._count.guardians,
          openingBalancePosted: s.openingBalance?.posted ?? false,
        },
      ]),
    ),
    canMedical: actor.permissions.has("students.medical.view"),
    today: new Date(),
  };
}

/** Step 1: read and check an uploaded file. Saves the parsed rows for the confirm step only. */
export async function previewImport(
  { db }: Deps,
  actor: Actor,
  file: { name: string; bytes: Buffer },
): Promise<{ batchId: string; plan: ImportPlan }> {
  assertCan(actor.permissions, "import.run");
  assertCan(actor.permissions, "students.view");
  if (file.bytes.length === 0)
    throw new ValidationError("Choose the filled-in Excel file.", "file");
  if (file.bytes.length > MAX_IMPORT_BYTES)
    throw new ValidationError("The file is bigger than 5 MB.", "file");
  if (!/\.xlsx$/i.test(file.name)) {
    throw new ValidationError(
      "Upload an Excel .xlsx file (use File → Save As → Excel Workbook).",
      "file",
    );
  }

  const { sheets, problems } = await readWorkbook(file.bytes);
  const payload: Payload = { sheets, problems };
  const fileHash = createHash("sha256").update(file.bytes).digest("hex");

  return withContext(db, ctxOf(actor), async (tx) => {
    const plan = validateImport(sheets, await loadImportContext(tx, actor), problems);
    const batch = await tx.importBatch.create({
      data: {
        schoolId: actor.schoolId,
        fileName: file.name.slice(0, 200),
        fileHash,
        payload: payload as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
    });
    await getStorage().put(
      schoolKey(actor.schoolId, "imports", `${batch.id}.xlsx`),
      file.bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return { batchId: batch.id, plan };
  });
}

/** The batch with a fresh check against today's data (so the preview is never stale). */
export async function getImportPreview({ db }: Deps, actor: Actor, batchId: string) {
  assertCan(actor.permissions, "import.run");
  return withContext(db, ctxOf(actor), async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) return null;
    if (batch.status === "imported") return { batch, plan: null };
    const payload = batch.payload as unknown as Payload;
    const plan = validateImport(
      payload.sheets,
      await loadImportContext(tx, actor),
      payload.problems,
    );
    return { batch, plan };
  });
}

export type ImportSummary = ImportPlan["counts"] & { fileName: string };

/** Step 2: import everything, or nothing. */
export async function confirmImport(
  { db }: Deps,
  actor: Actor,
  batchId: string,
): Promise<ImportSummary> {
  assertCan(actor.permissions, "import.run");
  assertCan(actor.permissions, "students.view");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new ValidationError("This upload was not found. Upload the file again.");
      if (batch.status !== "previewed")
        throw new ValidationError("This file has already been imported.");
      const payload = batch.payload as unknown as Payload;
      const plan = validateImport(
        payload.sheets,
        await loadImportContext(tx, actor),
        payload.problems,
      );
      if (plan.counts.errors > 0) {
        throw new ValidationError(
          `The file has ${plan.counts.errors} problem${plan.counts.errors === 1 ? "" : "s"} to fix first. Nothing was imported.`,
        );
      }
      await executePlan(tx, actor, plan, batch.fileName);

      const summary: ImportSummary = { ...plan.counts, fileName: batch.fileName };
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "imported", importedAt: new Date(), summary },
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "students.import",
        targetType: "import_batch",
        targetId: batchId,
        after: {
          fileName: batch.fileName,
          fileHash: batch.fileHash,
          rows: {
            classes: payload.sheets.Classes.length,
            students: payload.sheets.Students.length,
            guardians: payload.sheets.Guardians.length,
          },
          ...plan.counts,
        },
        ip: actor.ip,
      });
      return summary;
    },
    { timeoutMs: 180_000 },
  );
}

async function executePlan(tx: Tx, actor: Actor, plan: ImportPlan, fileName: string) {
  const schoolId = actor.schoolId;
  const today = new Date();

  if (plan.housesToCreate.length) {
    await tx.house.createMany({
      data: plan.housesToCreate.map((name) => ({ schoolId, name })),
      skipDuplicates: true,
    });
  }

  const classes = await tx.class.findMany({ include: { streams: true } });
  const classByName = new Map(classes.map((c) => [c.name.toLowerCase(), c]));
  const streamIds = new Map<string, string>();
  for (const c of classes)
    for (const s of c.streams) streamIds.set(`${c.name}|${s.name}`.toLowerCase(), s.id);

  for (const s of plan.streams) {
    const cls = classByName.get(s.className.toLowerCase())!;
    const key = `${s.className}|${s.streamName}`.toLowerCase();
    let id = streamIds.get(key);
    if (!id) {
      id = (await tx.stream.create({ data: { schoolId, classId: cls.id, name: s.streamName } })).id;
      streamIds.set(key, id);
    }
    if (s.teacherMembershipId) {
      await tx.stream.update({
        where: { id },
        data: { classTeacherMembershipId: s.teacherMembershipId },
      });
    }
  }

  const houses = new Map((await tx.house.findMany()).map((h) => [h.name.toLowerCase(), h.id]));
  const studentIds = new Map<string, string>();

  for (const p of plan.students) {
    const cls = classByName.get(p.className.toLowerCase())!;
    const data = {
      upi: p.upi,
      firstName: p.firstName,
      middleName: p.middleName,
      lastName: p.lastName,
      gender: p.gender,
      dateOfBirth: new Date(`${p.dateOfBirth}T00:00:00Z`),
      classId: cls.id,
      streamId: p.streamName
        ? streamIds.get(`${p.className}|${p.streamName}`.toLowerCase())!
        : null,
      boarder: p.boarder,
      houseId: p.houseName ? houses.get(p.houseName.toLowerCase())! : null,
      specialNeeds: p.specialNeeds,
    };
    const existing = await tx.student.findUnique({
      where: { schoolId_admissionNumber: { schoolId, admissionNumber: p.admissionNumber } },
    });
    let studentId: string;
    if (existing) {
      studentId = existing.id;
      await tx.student.update({ where: { id: studentId }, data });
    } else {
      const created = await tx.student.create({
        data: { ...data, schoolId, admissionNumber: p.admissionNumber, statusDate: today },
      });
      studentId = created.id;
      await tx.studentStatusChange.create({
        data: {
          schoolId,
          studentId,
          toStatus: "active",
          date: today,
          reason: `Imported from ${fileName}`.slice(0, 200),
          changedBy: actor.userId,
        },
      });
    }
    studentIds.set(admissionKey(p.admissionNumber), studentId);

    if (p.medicalNotes || p.allergies) {
      await tx.studentMedical.upsert({
        where: { studentId },
        create: { schoolId, studentId, medicalNotes: p.medicalNotes, allergies: p.allergies },
        update: { medicalNotes: p.medicalNotes, allergies: p.allergies },
      });
    }
    if (p.openingBalanceCents !== null) {
      await tx.openingBalance.upsert({
        where: { studentId },
        create: { schoolId, studentId, amountCents: p.openingBalanceCents, source: fileName },
        update: { amountCents: p.openingBalanceCents, source: fileName },
      });
    }
  }

  for (const g of plan.guardians) {
    let studentId = studentIds.get(admissionKey(g.admissionNumber));
    if (!studentId) {
      const s = await tx.student.findUnique({
        where: { schoolId_admissionNumber: { schoolId, admissionNumber: g.admissionNumber } },
      });
      if (!s) throw new ValidationError(`No student has admission number ${g.admissionNumber}.`);
      studentId = s.id;
    }
    await linkGuardian(tx, studentId, g);
  }
}

/** Template download data: the school's enabled levels and classes for the dropdowns. */
export async function templateLists({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "import.run");
  return withContext(db, ctxOf(actor), async (tx) => {
    const levels = await tx.level.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
      include: { classes: { orderBy: { position: "asc" } } },
    });
    return {
      levels: levels.map((l) => l.name),
      classes: levels.flatMap((l) => l.classes.map((c) => c.name)),
    };
  });
}
