/**
 * Students and their guardians. Permission checks happen here (server side) and again in the
 * database: row-level security limits class teachers to their own streams and hides medical
 * notes from anyone without "students.medical.view".
 */
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { normalizePhone } from "@/lib/phone";
import {
  type Actor,
  type Deps,
  ValidationError,
  clean,
  ctxOf,
  isoDate,
  parseDate,
} from "@/lib/service-kit";
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  getStorage,
  schoolKey,
} from "@/lib/storage";
import {
  type GenderValue,
  type LanguageValue,
  type RelationshipValue,
  type StatusValue,
  STATUSES,
  dateOfBirthProblem,
  guardianDefaults,
  parseBoarding,
  parseGender,
  parseLanguage,
  parseRelationship,
} from "./rules";

export function canViewStudents(actor: Actor) {
  return (
    actor.permissions.has("students.view") || actor.permissions.has("students.view.own_streams")
  );
}

function assertCanView(actor: Actor) {
  if (!canViewStudents(actor)) throw new ForbiddenError("students.view");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type StudentFilters = {
  q?: string;
  classId?: string;
  streamId?: string;
  boarding?: "boarder" | "day";
  status?: StatusValue | "all";
  page?: number;
};

export const PAGE_SIZE = 50;

export async function listStudents({ db }: Deps, actor: Actor, filters: StudentFilters) {
  assertCanView(actor);
  const q = clean(filters.q);
  const where: Prisma.StudentWhereInput = {
    schoolId: actor.schoolId,
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(!filters.status ? { status: "active" } : {}),
    ...(filters.classId ? { classId: filters.classId } : {}),
    ...(filters.streamId ? { streamId: filters.streamId } : {}),
    ...(filters.boarding ? { boarder: filters.boarding === "boarder" } : {}),
    ...(q
      ? {
          // Every word must match the admission number or one of the names.
          AND: q.split(" ").map((w) => ({
            OR: [
              { admissionNumber: { contains: w, mode: "insensitive" as const } },
              { firstName: { contains: w, mode: "insensitive" as const } },
              { middleName: { contains: w, mode: "insensitive" as const } },
              { lastName: { contains: w, mode: "insensitive" as const } },
            ],
          })),
        }
      : {}),
  };
  const page = Math.max(1, filters.page ?? 1);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [total, students] = await Promise.all([
      tx.student.count({ where }),
      tx.student.findMany({
        where,
        include: { class: true, stream: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    return { total, page, students };
  });
}

export async function getStudent({ db }: Deps, actor: Actor, studentId: string) {
  assertCanView(actor);
  return withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
      include: {
        class: { include: { level: true } },
        stream: true,
        house: true,
        pathway: true,
        guardians: {
          include: { user: { select: { phone: true } } },
          orderBy: { createdAt: "asc" },
        },
        statusChanges: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { createdAt: "desc" } },
        subjects: { include: { subject: true } },
        openingBalance: true,
      },
    });
    if (!student) return null;
    // Row-level security returns nothing here without students.medical.view.
    const medical = actor.permissions.has("students.medical.view")
      ? await tx.studentMedical.findUnique({ where: { schoolId: actor.schoolId, studentId } })
      : null;
    return { ...student, medical };
  });
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

export type StudentInput = {
  admissionNumber: string;
  upi: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: GenderValue;
  dateOfBirth: Date;
  classId: string;
  streamId: string | null;
  boarder: boolean;
  houseId: string | null;
  specialNeeds: string | null;
  medicalNotes: string | null;
  allergies: string | null;
};

export function parseStudentInput(raw: Record<string, unknown>, today = new Date()): StudentInput {
  const admissionNumber = clean(raw.admissionNumber);
  if (!admissionNumber) throw new ValidationError("Enter the admission number.", "admissionNumber");
  const firstName = clean(raw.firstName);
  if (!firstName) throw new ValidationError("Enter the first name.", "firstName");
  const lastName = clean(raw.lastName);
  if (!lastName) throw new ValidationError("Enter the last name.", "lastName");
  const gender = parseGender(raw.gender);
  if (!gender) throw new ValidationError("Choose female or male.", "gender");
  const dateOfBirth = parseDate(raw.dateOfBirth);
  if (!dateOfBirth) throw new ValidationError("Enter the date of birth.", "dateOfBirth");
  const dobProblem = dateOfBirthProblem(dateOfBirth, today);
  if (dobProblem) throw new ValidationError(`${dobProblem} Check the date.`, "dateOfBirth");
  const classId = clean(raw.classId);
  if (!classId) throw new ValidationError("Choose a class.", "classId");
  const boarder = parseBoarding(raw.boarding);
  if (boarder === null) throw new ValidationError("Choose boarder or day scholar.", "boarding");
  const upi = clean(raw.upi);
  if (upi && !/^[A-Za-z0-9-]{3,20}$/.test(upi)) {
    throw new ValidationError("The UPI should be letters and numbers only.", "upi");
  }
  return {
    admissionNumber,
    upi,
    firstName,
    middleName: clean(raw.middleName),
    lastName,
    gender,
    dateOfBirth,
    classId,
    streamId: clean(raw.streamId),
    boarder,
    houseId: clean(raw.houseId),
    specialNeeds: clean(raw.specialNeeds),
    medicalNotes: clean(raw.medicalNotes),
    allergies: clean(raw.allergies),
  };
}

export type GuardianInput = {
  name: string;
  phone: string;
  relationship: RelationshipValue;
  language: LanguageValue;
  receivesFees: boolean;
  receivesAcademics: boolean;
  receivesBoarding: boolean;
  authorisedToCollect: boolean;
  /** This phone uses WhatsApp (messages may go there, with SMS as the fallback). */
  whatsapp?: boolean;
};

/** `prefix` lets one form hold several guardians (g1_name, g2_name...). */
export function parseGuardianInput(raw: Record<string, unknown>, prefix = ""): GuardianInput {
  const f = (k: string) => raw[`${prefix}${k}`];
  const name = clean(f("name"));
  if (!name) throw new ValidationError("Enter the guardian's name.", `${prefix}name`);
  const phone = normalizePhone(String(f("phone") ?? ""));
  if (!phone) {
    throw new ValidationError(
      "Enter a valid phone number for the guardian, like 0712 345 678.",
      `${prefix}phone`,
    );
  }
  const relationship = parseRelationship(f("relationship"));
  if (!relationship) throw new ValidationError("Choose the relationship.", `${prefix}relationship`);
  const language = parseLanguage(f("language")) ?? "en";
  const defaults = guardianDefaults(relationship);
  // Forms send "<prefix>flags" so an unticked box (absent) means No; otherwise use defaults.
  const fromForm = f("flags") !== undefined;
  const flag = (k: keyof typeof defaults) => {
    const v = f(k);
    if (v === undefined) return fromForm ? false : defaults[k];
    return v === "on" || v === "true" || v === true;
  };
  return {
    name,
    phone,
    relationship,
    language,
    receivesFees: flag("receivesFees"),
    receivesAcademics: flag("receivesAcademics"),
    receivesBoarding: flag("receivesBoarding"),
    authorisedToCollect: flag("authorisedToCollect"),
    whatsapp: flag("whatsapp"),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Check class, stream and house belong together and to this school (RLS hides others). */
async function checkPlacement(
  tx: Tx,
  schoolId: string,
  input: Pick<StudentInput, "classId" | "streamId" | "houseId">,
) {
  const cls = await tx.class.findUnique({
    where: { schoolId, id: input.classId },
    include: { level: true, streams: true },
  });
  if (!cls || !cls.level.enabled) throw new ValidationError("Choose a class.", "classId");
  if (input.streamId && !cls.streams.some((s) => s.id === input.streamId)) {
    throw new ValidationError(`Choose a stream of ${cls.name}.`, "streamId");
  }
  if (!input.streamId && cls.streams.length > 0) {
    throw new ValidationError(`Choose a stream of ${cls.name}.`, "streamId");
  }
  if (input.houseId && !(await tx.house.findUnique({ where: { schoolId, id: input.houseId } }))) {
    throw new ValidationError("Choose a house.", "houseId");
  }
  return cls;
}

function studentSnapshot(s: {
  admissionNumber: string;
  upi: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string;
  dateOfBirth: Date;
  classId: string;
  streamId: string | null;
  boarder: boolean;
  houseId: string | null;
  specialNeeds: string | null;
}) {
  return {
    admissionNumber: s.admissionNumber,
    upi: s.upi,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    gender: s.gender,
    dateOfBirth: isoDate(s.dateOfBirth),
    classId: s.classId,
    streamId: s.streamId,
    boarder: s.boarder,
    houseId: s.houseId,
    specialNeeds: s.specialNeeds,
  };
}

/** Link a guardian through the database function (reuses the platform identity by phone). */
export async function linkGuardian(tx: Tx, schoolId: string, studentId: string, g: GuardianInput) {
  const [row] = await tx.$queryRaw<{ link_id: string; created: boolean }[]>`
    SELECT * FROM app_upsert_guardian_link(
      ${studentId}::uuid, ${g.phone}, ${g.name}, ${g.relationship}, ${g.language},
      ${g.receivesFees}, ${g.receivesAcademics}, ${g.receivesBoarding}, ${g.authorisedToCollect})`;
  if (g.whatsapp !== undefined) {
    await tx.guardianLink.update({
      where: { schoolId, id: row.link_id },
      data: { whatsapp: g.whatsapp },
    });
  }
  return { linkId: row.link_id, created: row.created };
}

export async function createStudent(
  { db }: Deps,
  actor: Actor,
  input: StudentInput,
  guardians: GuardianInput[],
): Promise<{ studentId: string }> {
  assertCan(actor.permissions, "students.edit");
  const hasMedical = !!(input.medicalNotes || input.allergies);
  if (hasMedical) assertCan(actor.permissions, "students.medical.view");
  const phones = guardians.map((g) => g.phone);
  if (new Set(phones).size !== phones.length) {
    throw new ValidationError("Two guardians have the same phone number.");
  }

  return withContext(db, ctxOf(actor), async (tx) => {
    await checkPlacement(tx, actor.schoolId, input);
    const exists = await tx.student.findUnique({
      where: {
        schoolId_admissionNumber: {
          schoolId: actor.schoolId,
          admissionNumber: input.admissionNumber,
        },
      },
    });
    if (exists) {
      throw new ValidationError(
        `Admission number ${input.admissionNumber} is already used in your school.`,
        "admissionNumber",
      );
    }
    const today = new Date();
    const student = await tx.student.create({
      data: {
        schoolId: actor.schoolId,
        admissionNumber: input.admissionNumber,
        upi: input.upi,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
        classId: input.classId,
        streamId: input.streamId,
        boarder: input.boarder,
        houseId: input.houseId,
        specialNeeds: input.specialNeeds,
        statusDate: today,
      },
    });
    await tx.studentStatusChange.create({
      data: {
        schoolId: actor.schoolId,
        studentId: student.id,
        toStatus: "active",
        date: today,
        reason: "Admitted",
        changedBy: actor.userId,
      },
    });
    if (hasMedical) {
      await tx.studentMedical.create({
        data: {
          schoolId: actor.schoolId,
          studentId: student.id,
          medicalNotes: input.medicalNotes,
          allergies: input.allergies,
        },
      });
    }
    for (const g of guardians) await linkGuardian(tx, actor.schoolId, student.id, g);

    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.create",
      targetType: "student",
      targetId: student.id,
      after: {
        ...studentSnapshot(student),
        medicalRecorded: hasMedical,
        guardians: guardians.map((g) => ({
          name: g.name,
          phone: g.phone,
          relationship: g.relationship,
        })),
      },
      ip: actor.ip,
    });
    return { studentId: student.id };
  });
}

export async function updateStudent(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  input: StudentInput,
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  const canMedical = actor.permissions.has("students.medical.view");
  await withContext(db, ctxOf(actor), async (tx) => {
    const before = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
    });
    if (!before) throw new ValidationError("Student not found.");
    await checkPlacement(tx, actor.schoolId, input);
    if (input.admissionNumber !== before.admissionNumber) {
      const clash = await tx.student.findUnique({
        where: {
          schoolId_admissionNumber: {
            schoolId: actor.schoolId,
            admissionNumber: input.admissionNumber,
          },
        },
      });
      if (clash) {
        throw new ValidationError(
          `Admission number ${input.admissionNumber} is already used.`,
          "admissionNumber",
        );
      }
    }
    const after = await tx.student.update({
      where: { schoolId: actor.schoolId, id: studentId },
      data: {
        admissionNumber: input.admissionNumber,
        upi: input.upi,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
        classId: input.classId,
        streamId: input.streamId,
        boarder: input.boarder,
        houseId: input.houseId,
        specialNeeds: input.specialNeeds,
      },
    });

    let medicalChanged = false;
    if (canMedical) {
      const existing = await tx.studentMedical.findUnique({
        where: { schoolId: actor.schoolId, studentId },
      });
      if (
        (existing?.medicalNotes ?? null) !== input.medicalNotes ||
        (existing?.allergies ?? null) !== input.allergies
      ) {
        medicalChanged = true;
        await tx.studentMedical.upsert({
          where: { studentId },
          create: {
            schoolId: actor.schoolId,
            studentId,
            medicalNotes: input.medicalNotes,
            allergies: input.allergies,
          },
          update: { medicalNotes: input.medicalNotes, allergies: input.allergies },
        });
      }
    }

    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.update",
      targetType: "student",
      targetId: studentId,
      before: studentSnapshot(before),
      // Medical text itself is not copied into the audit log, only the fact it changed.
      after: { ...studentSnapshot(after), medicalChanged },
      ip: actor.ip,
    });
  });
}

export async function changeStudentStatus(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  raw: { status: unknown; date: unknown; reason: unknown },
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  const status = STATUSES.find((s) => s.value === raw.status)?.value;
  if (!status) throw new ValidationError("Choose a status.", "status");
  const date = parseDate(raw.date);
  if (!date) throw new ValidationError("Enter the date.", "date");
  const reason = clean(raw.reason);
  if (status !== "active" && !reason) throw new ValidationError("Give a reason.", "reason");

  await withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
    });
    if (!student) throw new ValidationError("Student not found.");
    if (student.status === status)
      throw new ValidationError(`The student is already ${status}.`, "status");
    await tx.student.update({
      where: { schoolId: actor.schoolId, id: studentId },
      data: { status, statusDate: date, statusReason: reason },
    });
    await tx.studentStatusChange.create({
      data: {
        schoolId: actor.schoolId,
        studentId,
        fromStatus: student.status,
        toStatus: status,
        date,
        reason,
        changedBy: actor.userId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.status",
      targetType: "student",
      targetId: studentId,
      before: { status: student.status },
      after: { status, date: isoDate(date), reason },
      ip: actor.ip,
    });
  });
}

export async function addGuardian(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  g: GuardianInput,
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  await withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
    });
    if (!student) throw new ValidationError("Student not found.");
    const { linkId, created } = await linkGuardian(tx, actor.schoolId, studentId, g);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: created ? "guardian.link" : "guardian.update",
      targetType: "guardian_link",
      targetId: linkId,
      after: { studentId, ...g },
      ip: actor.ip,
    });
  });
}

export async function updateGuardian(
  { db }: Deps,
  actor: Actor,
  linkId: string,
  g: Omit<GuardianInput, "phone">,
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  await withContext(db, ctxOf(actor), async (tx) => {
    const before = await tx.guardianLink.findUnique({
      where: { schoolId: actor.schoolId, id: linkId },
    });
    if (!before) throw new ValidationError("Guardian not found.");
    await tx.guardianLink.update({ where: { schoolId: actor.schoolId, id: linkId }, data: g });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "guardian.update",
      targetType: "guardian_link",
      targetId: linkId,
      before: {
        name: before.name,
        relationship: before.relationship,
        language: before.language,
        receivesFees: before.receivesFees,
        receivesAcademics: before.receivesAcademics,
        receivesBoarding: before.receivesBoarding,
        authorisedToCollect: before.authorisedToCollect,
        whatsapp: before.whatsapp,
      },
      after: g,
      ip: actor.ip,
    });
  });
}

export async function removeGuardian({ db }: Deps, actor: Actor, linkId: string): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  await withContext(db, ctxOf(actor), async (tx) => {
    const link = await tx.guardianLink.findUnique({
      where: { schoolId: actor.schoolId, id: linkId },
    });
    if (!link) throw new ValidationError("Guardian not found.");
    await tx.guardianLink.delete({ where: { schoolId: actor.schoolId, id: linkId } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "guardian.unlink",
      targetType: "guardian_link",
      targetId: linkId,
      before: { studentId: link.studentId, userId: link.userId, name: link.name },
      ip: actor.ip,
    });
  });
}

export type Upload = { name: string; type: string; bytes: Buffer };

function checkUpload(file: Upload, allowed: string[]) {
  if (file.bytes.length === 0) throw new ValidationError("Choose a file.", "file");
  if (file.bytes.length > MAX_UPLOAD_BYTES)
    throw new ValidationError("The file is bigger than 5 MB.", "file");
  if (!allowed.includes(file.type)) {
    throw new ValidationError(
      allowed === IMAGE_TYPES ? "Use a JPG, PNG or WebP photo." : "Use a PDF or a photo.",
      "file",
    );
  }
}

export async function setStudentPhoto(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  file: Upload,
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  checkUpload(file, IMAGE_TYPES);
  await withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
    });
    if (!student) throw new ValidationError("Student not found.");
    const key = schoolKey(actor.schoolId, "students", studentId, `photo-${Date.now()}`);
    await getStorage().put(key, file.bytes, file.type);
    await tx.student.update({
      where: { schoolId: actor.schoolId, id: studentId },
      data: { photoKey: key },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.photo",
      targetType: "student",
      targetId: studentId,
      before: { photoKey: student.photoKey },
      after: { photoKey: key },
      ip: actor.ip,
    });
  });
}

export async function addStudentDocument(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  kindRaw: unknown,
  file: Upload,
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  const kind = clean(kindRaw);
  if (!kind) throw new ValidationError("Say what the document is.", "kind");
  checkUpload(file, DOCUMENT_TYPES);
  await withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
    });
    if (!student) throw new ValidationError("Student not found.");
    const key = schoolKey(actor.schoolId, "students", studentId, "documents", `${Date.now()}`);
    await getStorage().put(key, file.bytes, file.type);
    const doc = await tx.studentDocument.create({
      data: {
        schoolId: actor.schoolId,
        studentId,
        kind,
        fileKey: key,
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        uploadedById: actor.userId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.document",
      targetType: "student_document",
      targetId: doc.id,
      after: { studentId, kind, fileName: doc.fileName },
      ip: actor.ip,
    });
  });
}

/** Senior school: pathway and subject combination. */
export async function setStudentSubjects(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  pathwayId: string | null,
  subjectIds: string[],
): Promise<void> {
  assertCan(actor.permissions, "students.edit");
  await withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
      include: { class: true, subjects: true },
    });
    if (!student) throw new ValidationError("Student not found.");
    const levelId = student.class.levelId;
    if (
      pathwayId &&
      !(await tx.pathway.findFirst({ where: { schoolId: actor.schoolId, id: pathwayId, levelId } }))
    ) {
      throw new ValidationError("Choose a pathway for this level.", "pathwayId");
    }
    const unique = [...new Set(subjectIds)];
    const valid = await tx.subject.count({
      where: { schoolId: actor.schoolId, id: { in: unique }, levelId },
    });
    if (valid !== unique.length)
      throw new ValidationError("Choose subjects for this level.", "subjects");

    await tx.student.update({
      where: { schoolId: actor.schoolId, id: studentId },
      data: { pathwayId },
    });
    await tx.studentSubject.deleteMany({ where: { schoolId: actor.schoolId, studentId } });
    await tx.studentSubject.createMany({
      data: unique.map((subjectId) => ({ schoolId: actor.schoolId, studentId, subjectId })),
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.subjects",
      targetType: "student",
      targetId: studentId,
      before: {
        pathwayId: student.pathwayId,
        subjectIds: student.subjects.map((s) => s.subjectId),
      },
      after: { pathwayId, subjectIds: unique },
      ip: actor.ip,
    });
  });
}

/** Read a stored file of a student the actor can see. Returns null if not found / not allowed. */
export async function readStudentFile(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  which: { photo: true } | { documentId: string },
) {
  assertCanView(actor);
  const key = await withContext(db, ctxOf(actor), async (tx) => {
    if ("photo" in which) {
      return (
        (await tx.student.findUnique({ where: { schoolId: actor.schoolId, id: studentId } }))
          ?.photoKey ?? null
      );
    }
    const doc = await tx.studentDocument.findFirst({
      where: { schoolId: actor.schoolId, id: which.documentId, studentId },
    });
    return doc?.fileKey ?? null;
  });
  if (!key || !key.startsWith(`schools/${actor.schoolId}/`)) return null;
  return getStorage().get(key);
}
