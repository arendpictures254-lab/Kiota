/**
 * School structure: levels, classes, streams, houses, dormitories, academic years, terms,
 * subjects and pathways. All configuration data, edited by holders of "structure.manage".
 */
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import {
  type Actor,
  type Deps,
  ValidationError,
  clean,
  ctxOf,
  isoDate,
  parseDate,
} from "@/lib/service-kit";

function requireName(value: unknown, what: string, field = "name"): string {
  const name = clean(value);
  if (!name) throw new ValidationError(`Enter the ${what}.`, field);
  if (name.length > 60) throw new ValidationError(`The ${what} is too long.`, field);
  return name;
}

/** Turn unique-constraint errors into a friendly message. */
async function friendly<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError(`That ${what} already exists.`, "name");
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new ValidationError(`This ${what} is in use, so it cannot be removed.`);
    }
    throw err;
  }
}

async function run<T>(
  { db }: Deps,
  actor: Actor,
  action: string,
  fn: (tx: Tx) => Promise<{
    result: T;
    targetType: string;
    targetId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }>,
): Promise<T> {
  assertCan(actor.permissions, "structure.manage");
  return withContext(db, ctxOf(actor), async (tx) => {
    const r = await fn(tx);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action,
      targetType: r.targetType,
      targetId: r.targetId,
      before: r.before,
      after: r.after,
      ip: actor.ip,
    });
    return r.result;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Everything needed by the setup pages, students filters and the import template. */
export async function getStructure({ db }: Deps, actor: Actor) {
  return withContext(db, ctxOf(actor), async (tx) => {
    const [levels, houses, dormitories, years] = await Promise.all([
      tx.level.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          classes: {
            orderBy: { position: "asc" },
            include: {
              streams: {
                orderBy: { name: "asc" },
                include: { classTeacher: { include: { user: true } } },
              },
            },
          },
          subjects: { orderBy: { name: "asc" } },
          pathways: { orderBy: { name: "asc" } },
        },
      }),
      tx.house.findMany({ orderBy: { name: "asc" } }),
      tx.dormitory.findMany({ orderBy: { name: "asc" } }),
      tx.academicYear.findMany({
        orderBy: { startDate: "desc" },
        include: { terms: { orderBy: { startDate: "asc" } } },
      }),
    ]);
    return { levels, houses, dormitories, years };
  });
}

export type Structure = Awaited<ReturnType<typeof getStructure>>;

/** Flat list of classes in enabled levels, with their streams, in school order. */
export function enabledClasses(structure: Structure) {
  return structure.levels
    .filter((l) => l.enabled)
    .flatMap((l) => l.classes.map((c) => ({ ...c, levelName: l.name, levelKey: l.key })));
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Switch a level on or off. Switching on copies the default subjects/pathways if it has none. */
export async function setLevelEnabled(deps: Deps, actor: Actor, levelId: string, enabled: boolean) {
  return run(
    deps,
    actor,
    enabled ? "structure.level.enable" : "structure.level.disable",
    async (tx) => {
      const level = await tx.level.findUnique({ where: { id: levelId } });
      if (!level) throw new ValidationError("Level not found.");
      if (!enabled) {
        const inUse = await tx.student.count({
          where: { class: { levelId }, status: "active" },
        });
        if (inUse > 0) {
          throw new ValidationError(
            `${level.name} still has ${inUse} active students. Move them before switching it off.`,
          );
        }
      }
      await tx.level.update({ where: { id: levelId }, data: { enabled } });
      if (enabled) {
        const template = await tx.levelTemplate.findUnique({ where: { key: level.key } });
        if (template && (await tx.subject.count({ where: { levelId } })) === 0) {
          await tx.subject.createMany({
            data: template.subjects.map((name) => ({ schoolId: actor.schoolId, levelId, name })),
            skipDuplicates: true,
          });
          await tx.pathway.createMany({
            data: template.pathways.map((name) => ({ schoolId: actor.schoolId, levelId, name })),
            skipDuplicates: true,
          });
        }
      }
      return {
        result: undefined,
        targetType: "level",
        targetId: levelId,
        before: { enabled: level.enabled },
        after: { enabled },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

export async function addStream(deps: Deps, actor: Actor, classId: string, rawName: unknown) {
  const name = requireName(rawName, "stream name");
  return run(deps, actor, "structure.stream.add", async (tx) => {
    const cls = await tx.class.findUnique({ where: { id: classId }, include: { level: true } });
    if (!cls) throw new ValidationError("Choose a class.", "classId");
    if (!cls.level.enabled)
      throw new ValidationError(`${cls.level.name} is switched off.`, "classId");
    const stream = await friendly("stream", () =>
      tx.stream.create({ data: { schoolId: actor.schoolId, classId, name } }),
    );
    return {
      result: stream,
      targetType: "stream",
      targetId: stream.id,
      after: { class: cls.name, name },
    };
  });
}

export async function removeStream(deps: Deps, actor: Actor, streamId: string) {
  return run(deps, actor, "structure.stream.remove", async (tx) => {
    const stream = await tx.stream.findUnique({
      where: { id: streamId },
      include: { class: true },
    });
    if (!stream) throw new ValidationError("Stream not found.");
    const students = await tx.student.count({ where: { streamId } });
    if (students > 0) {
      throw new ValidationError(
        `${stream.class.name} ${stream.name} has students, so it cannot be removed.`,
      );
    }
    await tx.stream.delete({ where: { id: streamId } });
    return {
      result: undefined,
      targetType: "stream",
      targetId: streamId,
      before: { class: stream.class.name, name: stream.name },
    };
  });
}

/** Assign (or clear, with null) the class teacher of a stream. Must be an active staff member. */
export async function setClassTeacher(
  deps: Deps,
  actor: Actor,
  streamId: string,
  membershipId: string | null,
) {
  return run(deps, actor, "structure.stream.class_teacher", async (tx) => {
    const stream = await tx.stream.findUnique({ where: { id: streamId } });
    if (!stream) throw new ValidationError("Stream not found.");
    if (membershipId) {
      const m = await tx.membership.findUnique({ where: { id: membershipId } });
      if (!m || m.status !== "active") throw new ValidationError("Choose a staff member.");
    }
    await tx.stream.update({
      where: { id: streamId },
      data: { classTeacherMembershipId: membershipId },
    });
    return {
      result: undefined,
      targetType: "stream",
      targetId: streamId,
      before: { classTeacherMembershipId: stream.classTeacherMembershipId },
      after: { classTeacherMembershipId: membershipId },
    };
  });
}

// ---------------------------------------------------------------------------
// Houses and dormitories
// ---------------------------------------------------------------------------

export async function addHouse(deps: Deps, actor: Actor, rawName: unknown) {
  const name = requireName(rawName, "house name");
  return run(deps, actor, "structure.house.add", async (tx) => {
    const house = await friendly("house", () =>
      tx.house.create({ data: { schoolId: actor.schoolId, name } }),
    );
    return { result: house, targetType: "house", targetId: house.id, after: { name } };
  });
}

export async function removeHouse(deps: Deps, actor: Actor, houseId: string) {
  return run(deps, actor, "structure.house.remove", async (tx) => {
    const house = await tx.house.findUnique({ where: { id: houseId } });
    if (!house) throw new ValidationError("House not found.");
    if ((await tx.student.count({ where: { houseId } })) > 0) {
      throw new ValidationError(`${house.name} has students, so it cannot be removed.`);
    }
    await tx.house.delete({ where: { id: houseId } });
    return {
      result: undefined,
      targetType: "house",
      targetId: houseId,
      before: { name: house.name },
    };
  });
}

export async function addDormitory(
  deps: Deps,
  actor: Actor,
  rawName: unknown,
  rawCapacity: unknown,
) {
  const name = requireName(rawName, "dormitory name");
  const bedCapacity = Number(clean(rawCapacity));
  if (!Number.isInteger(bedCapacity) || bedCapacity < 1 || bedCapacity > 1000) {
    throw new ValidationError("Enter the number of beds (1 to 1000).", "bedCapacity");
  }
  return run(deps, actor, "structure.dormitory.add", async (tx) => {
    const dorm = await friendly("dormitory", () =>
      tx.dormitory.create({ data: { schoolId: actor.schoolId, name, bedCapacity } }),
    );
    return {
      result: dorm,
      targetType: "dormitory",
      targetId: dorm.id,
      after: { name, bedCapacity },
    };
  });
}

export async function removeDormitory(deps: Deps, actor: Actor, dormitoryId: string) {
  return run(deps, actor, "structure.dormitory.remove", async (tx) => {
    const dorm = await tx.dormitory.findUnique({ where: { id: dormitoryId } });
    if (!dorm) throw new ValidationError("Dormitory not found.");
    await tx.dormitory.delete({ where: { id: dormitoryId } });
    return {
      result: undefined,
      targetType: "dormitory",
      targetId: dormitoryId,
      before: { name: dorm.name, bedCapacity: dorm.bedCapacity },
    };
  });
}

// ---------------------------------------------------------------------------
// Academic years and terms
// ---------------------------------------------------------------------------

export async function addAcademicYear(
  deps: Deps,
  actor: Actor,
  input: { name: unknown; startDate: unknown; endDate: unknown },
) {
  const name = requireName(input.name, "year name");
  const startDate = parseDate(input.startDate);
  const endDate = parseDate(input.endDate);
  if (!startDate) throw new ValidationError("Enter the start date.", "startDate");
  if (!endDate) throw new ValidationError("Enter the end date.", "endDate");
  if (endDate <= startDate)
    throw new ValidationError("The year must end after it starts.", "endDate");
  return run(deps, actor, "structure.year.add", async (tx) => {
    const year = await friendly("academic year", () =>
      tx.academicYear.create({ data: { schoolId: actor.schoolId, name, startDate, endDate } }),
    );
    return {
      result: year,
      targetType: "academic_year",
      targetId: year.id,
      after: { name, startDate: isoDate(startDate), endDate: isoDate(endDate) },
    };
  });
}

export type TermInput = {
  academicYearId: string;
  name: unknown;
  startDate: unknown;
  halfTermStart?: unknown;
  halfTermEnd?: unknown;
  endDate: unknown;
};

/** Checks the dates of a term. Exported for unit tests. */
export function validateTermDates(
  t: {
    startDate: Date | null;
    halfTermStart: Date | null;
    halfTermEnd: Date | null;
    endDate: Date | null;
  },
  year: { startDate: Date; endDate: Date },
) {
  if (!t.startDate) throw new ValidationError("Enter the opening date.", "startDate");
  if (!t.endDate) throw new ValidationError("Enter the closing date.", "endDate");
  if (t.endDate <= t.startDate)
    throw new ValidationError("The term must close after it opens.", "endDate");
  if (t.startDate < year.startDate || t.endDate > year.endDate) {
    throw new ValidationError("The term must fall inside the academic year.", "startDate");
  }
  if (!!t.halfTermStart !== !!t.halfTermEnd) {
    throw new ValidationError("Enter both half-term dates, or neither.", "halfTermStart");
  }
  if (t.halfTermStart && t.halfTermEnd) {
    if (t.halfTermEnd < t.halfTermStart) {
      throw new ValidationError("Half-term must end after it starts.", "halfTermEnd");
    }
    if (t.halfTermStart <= t.startDate || t.halfTermEnd >= t.endDate) {
      throw new ValidationError("Half-term must fall inside the term.", "halfTermStart");
    }
  }
}

export async function addTerm(deps: Deps, actor: Actor, input: TermInput) {
  const name = requireName(input.name, "term name");
  const dates = {
    startDate: parseDate(input.startDate),
    halfTermStart: parseDate(input.halfTermStart),
    halfTermEnd: parseDate(input.halfTermEnd),
    endDate: parseDate(input.endDate),
  };
  return run(deps, actor, "structure.term.add", async (tx) => {
    const year = await tx.academicYear.findUnique({
      where: { id: input.academicYearId },
      include: { terms: true },
    });
    if (!year) throw new ValidationError("Choose an academic year.", "academicYearId");
    validateTermDates(dates, year);
    for (const other of year.terms) {
      if (dates.startDate! <= other.endDate && dates.endDate! >= other.startDate) {
        throw new ValidationError(`The dates overlap ${other.name}.`, "startDate");
      }
    }
    const term = await friendly("term", () =>
      tx.term.create({
        data: {
          schoolId: actor.schoolId,
          academicYearId: year.id,
          name,
          startDate: dates.startDate!,
          halfTermStart: dates.halfTermStart,
          halfTermEnd: dates.halfTermEnd,
          endDate: dates.endDate!,
        },
      }),
    );
    return {
      result: term,
      targetType: "term",
      targetId: term.id,
      after: {
        year: year.name,
        name,
        startDate: isoDate(dates.startDate),
        halfTermStart: isoDate(dates.halfTermStart),
        halfTermEnd: isoDate(dates.halfTermEnd),
        endDate: isoDate(dates.endDate),
      },
    };
  });
}

export async function removeTerm(deps: Deps, actor: Actor, termId: string) {
  return run(deps, actor, "structure.term.remove", async (tx) => {
    const term = await tx.term.findUnique({ where: { id: termId } });
    if (!term) throw new ValidationError("Term not found.");
    await tx.term.delete({ where: { id: termId } });
    return { result: undefined, targetType: "term", targetId: termId, before: { name: term.name } };
  });
}

// ---------------------------------------------------------------------------
// Subjects and pathways
// ---------------------------------------------------------------------------

export async function addSubject(
  deps: Deps,
  actor: Actor,
  input: { levelId: string; name: unknown; code?: unknown },
) {
  const name = requireName(input.name, "subject name");
  const code = clean(input.code);
  return run(deps, actor, "structure.subject.add", async (tx) => {
    const level = await tx.level.findUnique({ where: { id: input.levelId } });
    if (!level) throw new ValidationError("Choose a level.", "levelId");
    const subject = await friendly("subject", () =>
      tx.subject.create({ data: { schoolId: actor.schoolId, levelId: level.id, name, code } }),
    );
    return {
      result: subject,
      targetType: "subject",
      targetId: subject.id,
      after: { level: level.name, name, code },
    };
  });
}

export async function removeSubject(deps: Deps, actor: Actor, subjectId: string) {
  return run(deps, actor, "structure.subject.remove", async (tx) => {
    const subject = await tx.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new ValidationError("Subject not found.");
    if ((await tx.studentSubject.count({ where: { subjectId } })) > 0) {
      throw new ValidationError(`Students take ${subject.name}, so it cannot be removed.`);
    }
    await tx.subject.delete({ where: { id: subjectId } });
    return {
      result: undefined,
      targetType: "subject",
      targetId: subjectId,
      before: { name: subject.name },
    };
  });
}

export async function addPathway(
  deps: Deps,
  actor: Actor,
  input: { levelId: string; name: unknown },
) {
  const name = requireName(input.name, "pathway name");
  return run(deps, actor, "structure.pathway.add", async (tx) => {
    const level = await tx.level.findUnique({ where: { id: input.levelId } });
    if (!level) throw new ValidationError("Choose a level.", "levelId");
    const pathway = await friendly("pathway", () =>
      tx.pathway.create({ data: { schoolId: actor.schoolId, levelId: level.id, name } }),
    );
    return {
      result: pathway,
      targetType: "pathway",
      targetId: pathway.id,
      after: { level: level.name, name },
    };
  });
}

export async function removePathway(deps: Deps, actor: Actor, pathwayId: string) {
  return run(deps, actor, "structure.pathway.remove", async (tx) => {
    const pathway = await tx.pathway.findUnique({ where: { id: pathwayId } });
    if (!pathway) throw new ValidationError("Pathway not found.");
    if ((await tx.student.count({ where: { pathwayId } })) > 0) {
      throw new ValidationError(`Students follow ${pathway.name}, so it cannot be removed.`);
    }
    await tx.pathway.delete({ where: { id: pathwayId } });
    return {
      result: undefined,
      targetType: "pathway",
      targetId: pathwayId,
      before: { name: pathway.name },
    };
  });
}
