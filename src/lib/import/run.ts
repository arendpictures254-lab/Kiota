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
import { type ImportContext, type ImportPlan, admissionKey, validateImport } from "./validate";
import { type ReadProblem, type SheetRows, readWorkbook } from "./workbook";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type Payload = { sheets: SheetRows; problems: ReadProblem[] };

export async function loadImportContext(tx: Tx, actor: Actor): Promise<ImportContext> {
  const [levels, houses, staff, students] = await Promise.all([
    tx.level.findMany({
      where: { schoolId: actor.schoolId },
      orderBy: { sortOrder: "asc" },
      include: { classes: { orderBy: { position: "asc" }, include: { streams: true } } },
    }),
    tx.house.findMany({ where: { schoolId: actor.schoolId } }),
    tx.membership.findMany({
      where: { schoolId: actor.schoolId, status: "active" },
      include: { user: { select: { phone: true } } },
    }),
    tx.student.findMany({
      where: { schoolId: actor.schoolId },
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
    const batch = await tx.importBatch.findUnique({
      where: { schoolId: actor.schoolId, id: batchId },
    });
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
      const batch = await tx.importBatch.findUnique({
        where: { schoolId: actor.schoolId, id: batchId },
      });
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
        where: { schoolId: actor.schoolId, id: batchId },
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

  const classes = await tx.class.findMany({
    where: { schoolId: actor.schoolId },
    include: { streams: true },
  });
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
        where: { schoolId: actor.schoolId, id },
        data: { classTeacherMembershipId: s.teacherMembershipId },
      });
    }
  }

  const houses = new Map(
    (await tx.house.findMany({ where: { schoolId: actor.schoolId } })).map((h) => [
      h.name.toLowerCase(),
      h.id,
    ]),
  );
  const studentIds = new Map<string, string>();
  const reason = `Imported from ${fileName}`.slice(0, 200);

  const rowData = (p: ImportPlan["students"][number]) => {
    const cls = classByName.get(p.className.toLowerCase())!;
    return {
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
  };

  // Existing students (re-import): one query, then one UPDATE statement per batch.
  const existing = await tx.student.findMany({
    where: {
      schoolId: actor.schoolId,
      admissionNumber: { in: plan.students.map((p) => p.admissionNumber) },
    },
    select: { id: true, admissionNumber: true },
  });
  const existingIds = new Map(existing.map((s) => [s.admissionNumber, s.id]));
  const updates = plan.students.filter((p) => existingIds.has(p.admissionNumber));
  for (const batch of chunks(updates, BATCH)) {
    const rows = batch.map((p) => {
      const d = rowData(p);
      return { ...d, id: existingIds.get(p.admissionNumber)!, dateOfBirth: p.dateOfBirth };
    });
    await tx.$executeRaw`
      UPDATE students s SET
        upi = v.upi, first_name = v."firstName", middle_name = v."middleName",
        last_name = v."lastName", gender = v.gender::"Gender", date_of_birth = v."dateOfBirth",
        class_id = v."classId", stream_id = v."streamId", boarder = v.boarder,
        house_id = v."houseId", special_needs = v."specialNeeds", updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(
        id uuid, upi text, "firstName" text, "middleName" text, "lastName" text, gender text,
        "dateOfBirth" date, "classId" uuid, "streamId" uuid, boarder boolean, "houseId" uuid,
        "specialNeeds" text)
      WHERE s.id = v.id`;
  }
  for (const p of updates)
    studentIds.set(admissionKey(p.admissionNumber), existingIds.get(p.admissionNumber)!);

  // New students: inserted in batches, with their first status-history row.
  const fresh = plan.students.filter((p) => !existingIds.has(p.admissionNumber));
  for (const batch of chunks(fresh, BATCH)) {
    const created = await tx.student.createManyAndReturn({
      data: batch.map((p) => ({
        ...rowData(p),
        schoolId,
        admissionNumber: p.admissionNumber,
        statusDate: today,
      })),
      select: { id: true, admissionNumber: true },
    });
    await tx.studentStatusChange.createMany({
      data: created.map((s) => ({
        schoolId,
        studentId: s.id,
        toStatus: "active" as const,
        date: today,
        reason,
        changedBy: actor.userId,
      })),
    });
    for (const s of created) studentIds.set(admissionKey(s.admissionNumber), s.id);
  }
  const idOf = (admissionNumber: string) => studentIds.get(admissionKey(admissionNumber))!;

  // Medical notes (rare): one upsert each.
  for (const p of plan.students) {
    if (!p.medicalNotes && !p.allergies) continue;
    const studentId = idOf(p.admissionNumber);
    await tx.studentMedical.upsert({
      where: { schoolId, studentId },
      create: { schoolId, studentId, medicalNotes: p.medicalNotes, allergies: p.allergies },
      update: { medicalNotes: p.medicalNotes, allergies: p.allergies },
    });
  }

  // Opening balances: new ones in batches; existing unposted ones updated.
  const withBalance = plan.students.filter((p) => p.openingBalanceCents !== null);
  const haveBalance = new Set(
    (
      await tx.openingBalance.findMany({
        where: {
          schoolId: actor.schoolId,
          studentId: { in: withBalance.map((p) => idOf(p.admissionNumber)) },
        },
        select: { studentId: true },
      })
    ).map((b) => b.studentId),
  );
  for (const batch of chunks(withBalance, BATCH)) {
    await tx.openingBalance.createMany({
      data: batch
        .filter((p) => !haveBalance.has(idOf(p.admissionNumber)))
        .map((p) => ({
          schoolId,
          studentId: idOf(p.admissionNumber),
          amountCents: p.openingBalanceCents!,
          source: fileName,
        })),
    });
  }
  const balanceUpdates = withBalance
    .filter((p) => haveBalance.has(idOf(p.admissionNumber)))
    .map((p) => ({ studentId: idOf(p.admissionNumber), amountCents: p.openingBalanceCents! }));
  for (const batch of chunks(balanceUpdates, BATCH)) {
    // Posted balances were excluded by validation; the database trigger refuses them anyway.
    await tx.$executeRaw`
      UPDATE opening_balances b SET amount_cents = v."amountCents", source = ${fileName}, updated_at = now()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS v("studentId" uuid, "amountCents" int)
      WHERE b.student_id = v."studentId"
        AND (b.amount_cents IS DISTINCT FROM v."amountCents" OR b.source IS DISTINCT FROM ${fileName})`;
  }

  // Guardians: linked inside the database, a batch per round trip, through the same
  // app_upsert_guardian_link() rules as one-by-one linking.
  const missing = plan.guardians.filter((g) => !studentIds.has(admissionKey(g.admissionNumber)));
  if (missing.length) {
    const found = await tx.student.findMany({
      where: {
        schoolId: actor.schoolId,
        admissionNumber: { in: missing.map((g) => g.admissionNumber) },
      },
      select: { id: true, admissionNumber: true },
    });
    for (const s of found) studentIds.set(admissionKey(s.admissionNumber), s.id);
  }
  for (const batch of chunks(plan.guardians, BATCH)) {
    const rows = batch.map((g) => {
      const studentId = studentIds.get(admissionKey(g.admissionNumber));
      if (!studentId)
        throw new ValidationError(`No student has admission number ${g.admissionNumber}.`);
      return {
        studentId,
        phone: g.phone,
        name: g.name,
        relationship: g.relationship,
        language: g.language,
        receivesFees: g.receivesFees,
        receivesAcademics: g.receivesAcademics,
        receivesBoarding: g.receivesBoarding,
        authorisedToCollect: g.authorisedToCollect,
      };
    });
    await tx.$queryRaw`SELECT app_upsert_guardian_links(${JSON.stringify(rows)}::jsonb)`;
  }
}

const BATCH = 500;

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Template download data: the school's enabled levels and classes for the dropdowns. */
export async function templateLists({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "import.run");
  return withContext(db, ctxOf(actor), async (tx) => {
    const levels = await tx.level.findMany({
      where: { schoolId: actor.schoolId, enabled: true },
      orderBy: { sortOrder: "asc" },
      include: { classes: { orderBy: { position: "asc" } } },
    });
    return {
      levels: levels.map((l) => l.name),
      classes: levels.flatMap((l) => l.classes.map((c) => c.name)),
    };
  });
}
