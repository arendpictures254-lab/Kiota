/**
 * End-of-year promotion: move every active student of one class up to the next class, keeping
 * their stream name (Grade 7 East -> Grade 8 East). Students in the last class of a level whose
 * next level the school does not offer (or Grade 12 / Form 4) graduate instead.
 * Always preview first; the confirm step re-computes the same plan inside one transaction.
 */
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";

export type PromotionPlan = {
  fromClass: { id: string; name: string };
  /** Null = the students graduate. */
  toClass: { id: string; name: string } | null;
  moves: {
    fromStream: string | null;
    toStream: string | null;
    createStream: boolean;
    count: number;
  }[];
  total: number;
  warnings: string[];
};

async function computePlan(tx: Tx, schoolId: string, classId: string): Promise<PromotionPlan> {
  const cls = await tx.class.findUnique({
    where: { schoolId, id: classId },
    include: { level: true, streams: true },
  });
  if (!cls) throw new ValidationError("Choose a class.");

  let next = await tx.class.findFirst({
    where: { schoolId, levelId: cls.levelId, position: { gt: cls.position } },
    orderBy: { position: "asc" },
    include: { streams: true },
  });
  if (!next && cls.level.nextLevelKey) {
    const nextLevel = await tx.level.findFirst({
      where: { schoolId, key: cls.level.nextLevelKey, enabled: true },
    });
    if (nextLevel) {
      next = await tx.class.findFirst({
        where: { schoolId, levelId: nextLevel.id },
        orderBy: { position: "asc" },
        include: { streams: true },
      });
    }
  }

  const groups = await tx.student.groupBy({
    by: ["streamId"],
    where: { schoolId, classId, status: "active" },
    _count: { _all: true },
  });
  const streamName = (id: string | null) => cls.streams.find((s) => s.id === id)?.name ?? null;

  const moves = groups.map((g) => {
    const from = streamName(g.streamId);
    const target = next && from ? next.streams.find((s) => s.name === from) : undefined;
    return {
      fromStream: from,
      toStream: next ? (from ?? null) : null,
      createStream: !!next && !!from && !target,
      count: g._count._all,
    };
  });
  moves.sort((a, b) => (a.fromStream ?? "").localeCompare(b.fromStream ?? ""));

  const warnings: string[] = [];
  const total = moves.reduce((n, m) => n + m.count, 0);
  if (total === 0) warnings.push(`${cls.name} has no active students to promote.`);
  if (next) {
    const waiting = await tx.student.count({
      where: { schoolId, classId: next.id, status: "active" },
    });
    if (waiting > 0) {
      warnings.push(
        `${next.name} still has ${waiting} active students. Promote ${next.name} first, ` +
          `otherwise both years will be mixed in ${next.name}.`,
      );
    }
    if (moves.some((m) => !m.fromStream) && next.streams.length > 0) {
      warnings.push(
        `Some students in ${cls.name} have no stream; they will have no stream in ${next.name}.`,
      );
    }
  }
  return {
    fromClass: { id: cls.id, name: cls.name },
    toClass: next ? { id: next.id, name: next.name } : null,
    moves,
    total,
    warnings,
  };
}

export async function previewPromotion({ db }: Deps, actor: Actor, classId: string) {
  assertCan(actor.permissions, "structure.manage");
  assertCan(actor.permissions, "students.edit");
  return withContext(db, ctxOf(actor), (tx) => computePlan(tx, actor.schoolId, classId));
}

export async function promoteClass(
  { db }: Deps,
  actor: Actor,
  classId: string,
  options: { allowMixing?: boolean } = {},
): Promise<PromotionPlan> {
  assertCan(actor.permissions, "structure.manage");
  assertCan(actor.permissions, "students.edit");
  return withContext(
    db,
    ctxOf(actor),
    async (tx) => {
      const plan = await computePlan(tx, actor.schoolId, classId);
      if (plan.total === 0) throw new ValidationError(plan.warnings[0]);
      if (!options.allowMixing && plan.warnings.some((w) => w.includes("still has"))) {
        throw new ValidationError(plan.warnings.find((w) => w.includes("still has"))!);
      }
      const today = new Date();
      const students = await tx.student.findMany({
        where: { schoolId: actor.schoolId, classId, status: "active" },
        include: { stream: true },
      });

      if (plan.toClass) {
        const toClassId = plan.toClass.id;
        const streamIds = new Map<string, string>();
        for (const m of plan.moves) {
          if (!m.toStream) continue;
          const stream =
            (await tx.stream.findUnique({
              where: {
                schoolId: actor.schoolId,
                classId_name: { classId: toClassId, name: m.toStream },
              },
            })) ??
            (await tx.stream.create({
              data: { schoolId: actor.schoolId, classId: toClassId, name: m.toStream },
            }));
          streamIds.set(m.toStream, stream.id);
        }
        const [from, to] = await Promise.all([
          tx.class.findUniqueOrThrow({ where: { schoolId: actor.schoolId, id: classId } }),
          tx.class.findUniqueOrThrow({ where: { schoolId: actor.schoolId, id: toClassId } }),
        ]);
        const newLevel = from.levelId !== to.levelId;
        for (const s of students) {
          await tx.student.update({
            where: { schoolId: actor.schoolId, id: s.id },
            data: {
              classId: toClassId,
              streamId: s.stream ? (streamIds.get(s.stream.name) ?? null) : null,
              // A new level has different subjects: clear the old pathway and combination.
              ...(newLevel ? { pathwayId: null } : {}),
            },
          });
        }
        if (newLevel) {
          await tx.studentSubject.deleteMany({
            where: { schoolId: actor.schoolId, studentId: { in: students.map((s) => s.id) } },
          });
        }
      } else {
        for (const s of students) {
          await tx.student.update({
            where: { schoolId: actor.schoolId, id: s.id },
            data: {
              status: "graduated",
              statusDate: today,
              statusReason: `Completed ${plan.fromClass.name}`,
            },
          });
          await tx.studentStatusChange.create({
            data: {
              schoolId: actor.schoolId,
              studentId: s.id,
              fromStatus: "active",
              toStatus: "graduated",
              date: today,
              reason: `Completed ${plan.fromClass.name}`,
              changedBy: actor.userId,
            },
          });
        }
      }

      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "students.promote",
        targetType: "class",
        targetId: classId,
        before: { class: plan.fromClass.name },
        after: {
          toClass: plan.toClass?.name ?? null,
          graduated: plan.toClass ? 0 : plan.total,
          moved: plan.toClass ? plan.total : 0,
          moves: plan.moves,
        },
        ip: actor.ip,
      });
      return plan;
    },
    { timeoutMs: 60_000 },
  );
}
