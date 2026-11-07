/**
 * Academics configuration (academics.setup: Principal, Director of Studies, Director): grading
 * schemes and their levels, which scheme a level uses and whether it shows positions,
 * assessments and weights per term and level, teaching assignments, core competencies and
 * values, the comment bank and report card settings. All configuration data, never constants:
 * Kenyan defaults come from kiota_academic_defaults() in the database. Every change is audited.
 */
import { audit } from "@/lib/audit";
import type { PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { type Scheme, type SchemeLevel, weightProblems } from "./grading";

type Perms = ReadonlySet<PermissionKey>;
const ACADEMIC_PERMS: PermissionKey[] = [
  "academics.view",
  "academics.setup",
  "marks.enter",
  "marks.signoff",
  "marks.unlock",
  "results.approve",
  "reports.print",
];
export const canSeeAcademics = (p: Perms) => ACADEMIC_PERMS.some((k) => p.has(k));
export function assertSeeAcademics(p: Perms) {
  if (!canSeeAcademics(p)) throw new ForbiddenError("academics.view");
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

export type SchemeRow = Scheme & {
  id: string;
  name: string;
  note: string | null;
  positionsDefault: boolean;
  defaultLevelKeys: string[];
  forCompetencies: boolean;
  levels: (SchemeLevel & { id: string })[];
};

export async function schemesIn(tx: Tx, schoolId: string): Promise<SchemeRow[]> {
  const rows = await tx.gradingScheme.findMany({
    where: { schoolId },
    include: { levels: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    note: r.note,
    roundMarks: r.roundMarks,
    positionsDefault: r.positionsDefault,
    defaultLevelKeys: r.defaultLevelKeys,
    forCompetencies: r.forCompetencies,
    levels: r.levels.map((l) => ({
      id: l.id,
      code: l.code,
      label: l.label,
      points: l.points,
      minMark: l.minMark,
      maxMark: l.maxMark,
      comment: l.comment,
    })),
  }));
}

/** The scheme a level uses: its own choice, else the scheme made for its key. */
export function schemeOf(
  schemes: SchemeRow[],
  level: { key: string; gradingSchemeId: string | null },
): SchemeRow | null {
  return (
    schemes.find((s) => s.id === level.gradingSchemeId) ??
    schemes.find((s) => s.defaultLevelKeys.includes(level.key)) ??
    null
  );
}

export function positionsOn(
  level: { showPositions: boolean | null },
  scheme: Pick<SchemeRow, "positionsDefault"> | null,
) {
  return level.showPositions ?? scheme?.positionsDefault ?? false;
}

export async function myMembershipId(tx: Tx, actor: Actor) {
  const m = await tx.membership.findFirst({
    where: { schoolId: actor.schoolId, userId: actor.userId, status: "active" },
    select: { id: true },
  });
  return m?.id ?? null;
}

export type TermOption = { id: string; label: string; startDate: Date; endDate: Date };

export async function termsIn(tx: Tx, schoolId: string): Promise<TermOption[]> {
  const terms = await tx.term.findMany({
    where: { schoolId },
    include: { academicYear: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
  return terms.map((t) => ({
    id: t.id,
    label: `${t.name} ${t.academicYear.name}`,
    startDate: t.startDate,
    endDate: t.endDate,
  }));
}

/** The term marks are about now: the one running, else the last one that ended, else the next. */
export function defaultTerm(terms: TermOption[], now = new Date()) {
  const running = terms.find((t) => t.startDate <= now && now <= endOfDay(t.endDate));
  if (running) return running;
  const past = terms.filter((t) => endOfDay(t.endDate) < now);
  return past[past.length - 1] ?? terms[0] ?? null;
}
const endOfDay = (d: Date) => new Date(d.getTime() + 86_400_000 - 1);

/** Assessments of a term and level, with each subject's own weights. */
export async function assessmentsFor(tx: Tx, schoolId: string, termId: string, levelId: string) {
  const rows = await tx.assessment.findMany({
    where: { schoolId, termId, levelId },
    include: { weights: true },
    orderBy: { position: "asc" },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    maxMarks: a.maxMarks,
    weight: a.weight,
    position: a.position,
    overrides: new Map(a.weights.map((w) => [w.subjectId, w.weight])),
  }));
}
export type AssessmentRow = Awaited<ReturnType<typeof assessmentsFor>>[number];

// ---------------------------------------------------------------------------
// Overview and grading
// ---------------------------------------------------------------------------

export async function academicsSetup({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "academics.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const [schemes, levels, terms, settings, competencies] = await Promise.all([
      schemesIn(tx, actor.schoolId),
      tx.level.findMany({
        where: { schoolId: actor.schoolId, enabled: true },
        orderBy: { sortOrder: "asc" },
        include: { subjects: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
      }),
      termsIn(tx, actor.schoolId),
      tx.schoolSettings.findUnique({ where: { schoolId: actor.schoolId } }),
      tx.competency.findMany({
        where: { schoolId: actor.schoolId },
        orderBy: [{ kind: "asc" }, { position: "asc" }],
      }),
    ]);
    return {
      schemes,
      levels: levels.map((l) => {
        const scheme = schemeOf(schemes, l);
        return {
          id: l.id,
          name: l.name,
          subjects: l.subjects,
          schemeId: scheme?.id ?? null,
          schemeName: scheme?.name ?? "No scheme",
          ownScheme: l.gradingSchemeId !== null,
          showPositions: l.showPositions,
          positions: positionsOn(l, scheme),
        };
      }),
      terms,
      report: {
        template: settings?.reportTemplate ?? "classic",
        showFeeBalance: settings?.reportShowFeeBalance ?? true,
        showNextTerm: settings?.reportShowNextTerm ?? true,
      },
      competencies,
    };
  });
}

const intIn = (v: unknown, field: string, min: number, max: number) => {
  const n = Number(clean(v));
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ValidationError(`Enter a whole number from ${min} to ${max}.`, field);
  return n;
};

/** Replace a scheme's levels (code, label, points, range, comment). */
export async function saveSchemeLevels(
  { db }: Deps,
  actor: Actor,
  schemeId: string,
  rows: {
    code: unknown;
    label: unknown;
    points: unknown;
    minMark: unknown;
    maxMark: unknown;
    comment?: unknown;
  }[],
) {
  assertCan(actor.permissions, "academics.setup");
  const levels = rows
    .filter((r) => clean(r.code))
    .map((r, i) => ({
      code: clean(r.code)!.toUpperCase(),
      label: clean(r.label) ?? clean(r.code)!,
      points: intIn(r.points, `points-${i}`, 0, 100),
      minMark: intIn(r.minMark, `min-${i}`, 0, 100),
      maxMark: intIn(r.maxMark, `max-${i}`, 0, 100),
      comment: clean(r.comment),
    }));
  if (levels.length < 2) throw new ValidationError("A scheme needs at least two levels.");
  if (new Set(levels.map((l) => l.code)).size !== levels.length)
    throw new ValidationError("Each level needs its own code.");
  for (const l of levels)
    if (l.minMark > l.maxMark)
      throw new ValidationError(`${l.code}: the lowest mark is above the highest.`);
  if (!levels.some((l) => l.minMark === 0))
    throw new ValidationError("One level must start at 0, so every mark has a level.");
  return withContext(db, ctxOf(actor), async (tx) => {
    const scheme = await tx.gradingScheme.findUnique({
      where: { schoolId: actor.schoolId, id: schemeId },
      include: { levels: { orderBy: { position: "asc" } } },
    });
    if (!scheme) throw new ValidationError("Scheme not found.");
    await tx.gradingLevel.deleteMany({ where: { schoolId: actor.schoolId, schemeId } });
    await tx.gradingLevel.createMany({
      data: levels.map((l, i) => ({ schoolId: actor.schoolId, schemeId, position: i + 1, ...l })),
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.scheme_update",
      targetType: "grading_scheme",
      targetId: schemeId,
      before: scheme.levels.map(({ code, points, minMark, maxMark }) => ({
        code,
        points,
        minMark,
        maxMark,
      })),
      after: levels.map(({ code, points, minMark, maxMark }) => ({
        code,
        points,
        minMark,
        maxMark,
      })),
      ip: actor.ip,
    });
  });
}

/** Which scheme a level uses, and positions on, off or the scheme's default. */
export async function setLevelGrading(
  { db }: Deps,
  actor: Actor,
  levelId: string,
  input: { schemeId?: unknown; positions?: unknown },
) {
  assertCan(actor.permissions, "academics.setup");
  const positions = String(input.positions ?? "default");
  const showPositions = positions === "on" ? true : positions === "off" ? false : null;
  const schemeId = clean(input.schemeId);
  return withContext(db, ctxOf(actor), async (tx) => {
    const level = await tx.level.findUnique({ where: { schoolId: actor.schoolId, id: levelId } });
    if (!level) throw new ValidationError("Level not found.");
    if (schemeId) {
      const s = await tx.gradingScheme.findUnique({
        where: { schoolId: actor.schoolId, id: schemeId },
      });
      if (!s) throw new ValidationError("Scheme not found.", "schemeId");
    }
    await tx.level.update({
      where: { schoolId: actor.schoolId, id: levelId },
      data: { gradingSchemeId: schemeId, showPositions },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.level_grading",
      targetType: "level",
      targetId: levelId,
      before: { schemeId: level.gradingSchemeId, showPositions: level.showPositions },
      after: { schemeId, showPositions },
      ip: actor.ip,
    });
  });
}

export async function updateReportSettings(
  { db }: Deps,
  actor: Actor,
  input: { template?: unknown; showFeeBalance?: unknown; showNextTerm?: unknown },
) {
  assertCan(actor.permissions, "academics.setup");
  const template = input.template === "modern" ? "modern" : "classic";
  const data = {
    reportTemplate: template,
    reportShowFeeBalance: input.showFeeBalance === "on" || input.showFeeBalance === true,
    reportShowNextTerm: input.showNextTerm === "on" || input.showNextTerm === true,
  };
  return withContext(db, ctxOf(actor), async (tx) => {
    await tx.schoolSettings.upsert({
      where: { schoolId: actor.schoolId },
      create: { schoolId: actor.schoolId, ...data },
      update: data,
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.report_settings",
      after: data,
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Assessments and weights
// ---------------------------------------------------------------------------

export async function assessmentPlan({ db }: Deps, actor: Actor, termId: string, levelId: string) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const [level, term, assessments, marked] = await Promise.all([
      tx.level.findUnique({
        where: { schoolId: actor.schoolId, id: levelId },
        include: { subjects: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
      }),
      tx.term.findUnique({
        where: { schoolId: actor.schoolId, id: termId },
        include: { academicYear: { select: { name: true } } },
      }),
      assessmentsFor(tx, actor.schoolId, termId, levelId),
      tx.mark.groupBy({
        by: ["assessmentId"],
        where: { schoolId: actor.schoolId, assessment: { termId, levelId } },
        _count: { _all: true },
      }),
    ]);
    if (!level || !term) return null;
    return {
      level: { id: level.id, name: level.name },
      term: { id: term.id, label: `${term.name} ${term.academicYear.name}` },
      subjects: level.subjects,
      assessments: assessments.map((a) => ({
        ...a,
        overrides: Object.fromEntries(a.overrides),
        marks: marked.find((m) => m.assessmentId === a.id)?._count._all ?? 0,
      })),
    };
  });
}

export type PlanInput = {
  id?: string | null;
  name: unknown;
  maxMarks: unknown;
  weight: unknown;
  /** subjectId → weight, only where it differs from the assessment's weight. */
  overrides?: Record<string, unknown>;
}[];

/**
 * Save a term and level's assessments in one go. Refused unless every subject's weights add up
 * to 100. Assessments that already have marks cannot be removed.
 */
export async function saveAssessmentPlan(
  { db }: Deps,
  actor: Actor,
  termId: string,
  levelId: string,
  input: PlanInput,
) {
  assertCan(actor.permissions, "academics.setup");
  const rows = input
    .filter((r) => clean(r.name))
    .map((r, i) => ({
      id: clean(r.id),
      name: clean(r.name)!,
      maxMarks: intIn(r.maxMarks, `max-${i}`, 1, 1000),
      weight: intIn(r.weight, `weight-${i}`, 0, 100),
      overrides: Object.fromEntries(
        Object.entries(r.overrides ?? {})
          .filter(([, v]) => clean(v) !== null)
          .map(([k, v]) => [k, intIn(v, `weight-${i}-${k}`, 0, 100)]),
      ),
    }));
  if (new Set(rows.map((r) => r.name.toLowerCase())).size !== rows.length)
    throw new ValidationError("Two assessments have the same name.");
  return withContext(db, ctxOf(actor), async (tx) => {
    const level = await tx.level.findUnique({
      where: { schoolId: actor.schoolId, id: levelId },
      include: { subjects: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
    });
    const term = await tx.term.findUnique({ where: { schoolId: actor.schoolId, id: termId } });
    if (!level || !term) throw new ValidationError("Term or level not found.");
    const subjectIds = new Set(level.subjects.map((s) => s.id));
    for (const r of rows)
      for (const k of Object.keys(r.overrides))
        if (!subjectIds.has(k)) throw new ValidationError("Unknown subject in the weights.");
    const problems = weightProblems({ assessments: rows, subjects: level.subjects });
    if (problems.length)
      throw new ValidationError(
        `Weights must add up to 100% for every subject: ${problems
          .slice(0, 4)
          .map((p) => `${p.subject} ${p.total}%`)
          .join(", ")}${problems.length > 4 ? ` and ${problems.length - 4} more` : ""}.`,
        "weights",
      );
    const before = await assessmentsFor(tx, actor.schoolId, termId, levelId);
    const keep = new Set(rows.map((r) => r.id).filter(Boolean));
    for (const old of before.filter((b) => !keep.has(b.id))) {
      const n = await tx.mark.count({ where: { schoolId: actor.schoolId, assessmentId: old.id } });
      if (n) throw new ValidationError(`${old.name} already has marks and cannot be removed.`);
      await tx.assessment.delete({ where: { schoolId: actor.schoolId, id: old.id } });
    }
    // Free the names first (unique per term and level) so assessments can swap names.
    for (const [i, r] of rows.entries())
      if (r.id && before.some((b) => b.id === r.id))
        await tx.assessment.update({
          where: { schoolId: actor.schoolId, id: r.id },
          data: { name: `__renaming ${i} ${r.id}` },
        });
    for (const [i, r] of rows.entries()) {
      const data = { name: r.name, maxMarks: r.maxMarks, weight: r.weight, position: i + 1 };
      const id =
        r.id && before.some((b) => b.id === r.id)
          ? (await tx.assessment.update({ where: { schoolId: actor.schoolId, id: r.id }, data })).id
          : (
              await tx.assessment.create({
                data: { schoolId: actor.schoolId, termId, levelId, ...data },
              })
            ).id;
      await tx.assessmentWeight.deleteMany({
        where: { schoolId: actor.schoolId, assessmentId: id },
      });
      const overrides = Object.entries(r.overrides).filter(([, w]) => w !== r.weight);
      if (overrides.length)
        await tx.assessmentWeight.createMany({
          data: overrides.map(([subjectId, weight]) => ({
            schoolId: actor.schoolId,
            assessmentId: id,
            subjectId,
            weight,
          })),
        });
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.assessments_update",
      targetType: "level",
      targetId: levelId,
      before: before.map((b) => ({ name: b.name, maxMarks: b.maxMarks, weight: b.weight })),
      after: rows.map((r) => ({
        name: r.name,
        maxMarks: r.maxMarks,
        weight: r.weight,
        overrides: r.overrides,
      })),
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Teaching assignments
// ---------------------------------------------------------------------------

export async function teachingOverview({ db }: Deps, actor: Actor) {
  assertCan(actor.permissions, "academics.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const [streams, assignments, staff] = await Promise.all([
      tx.stream.findMany({
        where: { schoolId: actor.schoolId, class: { level: { enabled: true } } },
        include: {
          class: {
            include: {
              level: {
                include: {
                  subjects: { orderBy: { name: "asc" }, select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [
          { class: { level: { sortOrder: "asc" } } },
          { class: { position: "asc" } },
          { name: "asc" },
        ],
      }),
      tx.teachingAssignment.findMany({ where: { schoolId: actor.schoolId } }),
      tx.membership.findMany({
        where: {
          schoolId: actor.schoolId,
          status: "active",
          roles: { some: { role: { permissions: { some: { permissionKey: "marks.enter" } } } } },
        },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
    ]);
    return {
      teachers: staff,
      streams: streams.map((s) => ({
        id: s.id,
        name: `${s.class.name} ${s.name}`,
        subjects: s.class.level.subjects.map((sub) => ({
          ...sub,
          membershipId:
            assignments.find((a) => a.streamId === s.id && a.subjectId === sub.id)?.membershipId ??
            null,
        })),
      })),
    };
  });
}

/** Give a stream's subject to a teacher (or nobody: the subject is not taught there). */
export async function assignTeacher(
  { db }: Deps,
  actor: Actor,
  streamId: string,
  subjectId: string,
  membershipId: string | null,
) {
  assertCan(actor.permissions, "academics.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const stream = await tx.stream.findUnique({
      where: { schoolId: actor.schoolId, id: streamId },
      include: { class: { select: { levelId: true } } },
    });
    const subject = await tx.subject.findUnique({
      where: { schoolId: actor.schoolId, id: subjectId },
    });
    if (!stream || !subject || subject.levelId !== stream.class.levelId)
      throw new ValidationError("That subject is not taught at this stream's level.");
    if (membershipId) {
      const m = await tx.membership.findUnique({
        where: { schoolId: actor.schoolId, id: membershipId },
        select: { status: true },
      });
      if (!m || m.status !== "active") throw new ValidationError("Teacher not found.");
    }
    const before = await tx.teachingAssignment.findUnique({
      where: { schoolId: actor.schoolId, streamId_subjectId: { streamId, subjectId } },
    });
    if (membershipId)
      await tx.teachingAssignment.upsert({
        where: { schoolId: actor.schoolId, streamId_subjectId: { streamId, subjectId } },
        create: { schoolId: actor.schoolId, streamId, subjectId, membershipId },
        update: { membershipId },
      });
    else if (before)
      await tx.teachingAssignment.delete({ where: { schoolId: actor.schoolId, id: before.id } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.teaching_assign",
      targetType: "stream",
      targetId: streamId,
      before: { subjectId, membershipId: before?.membershipId ?? null },
      after: { subjectId, membershipId },
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// Competencies, values and the comment bank
// ---------------------------------------------------------------------------

export async function saveCompetency(
  { db }: Deps,
  actor: Actor,
  input: { id?: unknown; kind?: unknown; name?: unknown; active?: unknown },
) {
  assertCan(actor.permissions, "academics.setup");
  const name = clean(input.name);
  if (!name) throw new ValidationError("Enter a name.", "name");
  const kind = input.kind === "value" ? "value" : "competency";
  const id = clean(input.id);
  return withContext(db, ctxOf(actor), async (tx) => {
    if (id) {
      await tx.competency.update({
        where: { schoolId: actor.schoolId, id },
        data: { name, active: input.active !== "off" && input.active !== false },
      });
    } else {
      const n = await tx.competency.count({ where: { schoolId: actor.schoolId, kind } });
      await tx.competency.create({
        data: { schoolId: actor.schoolId, kind, name, position: n + 1 },
      });
    }
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.competency_save",
      after: { id, kind, name },
      ip: actor.ip,
    });
  });
}

export async function commentBank({ db }: Deps, actor: Actor, levelId: string) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), (tx) =>
    tx.commentBank.findMany({
      where: { schoolId: actor.schoolId, levelId },
      orderBy: [{ author: "asc" }, { bandCode: "asc" }, { createdAt: "asc" }],
      select: { id: true, author: true, bandCode: true, text: true },
    }),
  );
}

export async function addBankComment(
  { db }: Deps,
  actor: Actor,
  input: { levelId?: unknown; author?: unknown; bandCode?: unknown; text?: unknown },
) {
  assertCan(actor.permissions, "academics.setup");
  const text = clean(input.text);
  const bandCode = clean(input.bandCode)?.toUpperCase();
  if (!text) throw new ValidationError("Write the comment.", "text");
  if (!bandCode) throw new ValidationError("Choose the level it is for.", "bandCode");
  const author = input.author === "principal" ? "principal" : "class_teacher";
  return withContext(db, ctxOf(actor), async (tx) => {
    const level = await tx.level.findUnique({
      where: { schoolId: actor.schoolId, id: String(input.levelId ?? "") },
    });
    if (!level) throw new ValidationError("Level not found.");
    await tx.commentBank.create({
      data: { schoolId: actor.schoolId, levelId: level.id, author, bandCode, text },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.comment_bank_add",
      targetType: "level",
      targetId: level.id,
      after: { author, bandCode, text },
      ip: actor.ip,
    });
  });
}

export async function removeBankComment({ db }: Deps, actor: Actor, id: string) {
  assertCan(actor.permissions, "academics.setup");
  return withContext(db, ctxOf(actor), async (tx) => {
    const row = await tx.commentBank.findFirst({ where: { schoolId: actor.schoolId, id } });
    if (!row) return;
    await tx.commentBank.deleteMany({ where: { schoolId: actor.schoolId, id } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "academics.comment_bank_remove",
      targetType: "comment_bank",
      targetId: id,
      before: { bandCode: row.bandCode, text: row.text },
      ip: actor.ip,
    });
  });
}

/** The school's terms and the one to show (the asked-for term, else the default). */
export async function termChoice({ db }: Deps, actor: Actor, termId?: string | null) {
  assertSeeAcademics(actor.permissions);
  return withContext(db, ctxOf(actor), async (tx) => {
    const terms = await termsIn(tx, actor.schoolId);
    return { terms, term: terms.find((t) => t.id === termId) ?? defaultTerm(terms) };
  });
}
