/**
 * Grading maths (pure, isomorphic: the mark grid uses it to show the level as a mark is typed).
 *
 * Units: marks are in tenths (73.5 marks = 735); percentages are in tenths of a percent
 * (89.5% = 895); mean points are in hundredths (7.25 points = 725). Integers throughout, so
 * results never drift with floating point.
 *
 * Rules:
 *  - A subject's term result is the weighted average of its assessments as percentages.
 *    Absent and Exempt are left out and the remaining weights are scaled up to 100 (never
 *    counted as zero). Marks not entered yet are left out the same way and flagged.
 *  - A percentage takes the highest level whose minimum it reaches. With "round marks" (the
 *    default) it is rounded to a whole mark first, half up: 89.5 becomes 90.
 *  - Mean points are rounded half up to a whole point to give the mean grade (KCSE style).
 *  - Positions: higher mean points first, then higher mean score; equal students share a place
 *    (1, 2, 2, 4).
 */

export type SchemeLevel = {
  code: string;
  label: string;
  points: number;
  minMark: number;
  maxMark: number;
  comment?: string | null;
};

export type Scheme = { roundMarks: boolean; levels: SchemeLevel[] };

export type MarkStatus = "score" | "absent" | "exempt";
export type MarkValue = { status: MarkStatus; scoreTenths: number | null };

/** Half-up integer division for non-negative numbers. */
const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

/** An assessment mark as a percentage, in tenths of a percent. */
export function percentTenths(scoreTenths: number, maxMarks: number) {
  return divRound(scoreTenths * 100, maxMarks);
}

/** The score graded: whole percent (as tenths) when the scheme rounds, as given otherwise. */
export function gradedTenths(scheme: Pick<Scheme, "roundMarks">, pctTenths: number) {
  return scheme.roundMarks ? divRound(pctTenths, 10) * 10 : pctTenths;
}

const byMinDesc = (levels: SchemeLevel[]) => [...levels].sort((a, b) => b.minMark - a.minMark);

/** The level for a percentage (in tenths). Below every minimum: the lowest level. */
export function gradeFor(scheme: Scheme, pctTenths: number): SchemeLevel | null {
  if (!scheme.levels.length) return null;
  const p = gradedTenths(scheme, pctTenths);
  const sorted = byMinDesc(scheme.levels);
  return sorted.find((l) => l.minMark * 10 <= p) ?? sorted[sorted.length - 1];
}

/** The mean grade from mean points (hundredths), rounded half up to a whole point. */
export function meanGradeFor(scheme: Scheme, meanPointsHundredths: number): SchemeLevel | null {
  if (!scheme.levels.length) return null;
  const rounded = divRound(meanPointsHundredths, 100);
  const byPoints = [...scheme.levels].sort((a, b) => b.points - a.points);
  return (
    byPoints.find((l) => l.points === rounded) ??
    byPoints.find((l) => l.points <= rounded) ??
    byPoints[byPoints.length - 1]
  );
}

export type AssessmentWeighting = { id: string; maxMarks: number; weight: number };

export type SubjectResult = {
  /** Weighted percentage in tenths; null when nothing counts (all absent, exempt or missing). */
  pctTenths: number | null;
  /** Why there is no result, or what is left out. */
  status: "ok" | "absent" | "exempt" | "missing";
  /** Assessments (with weight) that have no mark yet. */
  missing: number;
};

/** A subject's term result from its assessments (weight > 0 only) and the student's marks. */
export function subjectResult(
  assessments: AssessmentWeighting[],
  marks: ReadonlyMap<string, MarkValue>,
): SubjectResult {
  let sum = 0;
  let weights = 0;
  let missing = 0;
  let absent = 0;
  let exempt = 0;
  for (const a of assessments) {
    if (a.weight <= 0) continue;
    const m = marks.get(a.id);
    if (!m) missing++;
    else if (m.status === "absent") absent++;
    else if (m.status === "exempt") exempt++;
    else if (m.scoreTenths !== null) {
      sum += a.weight * percentTenths(m.scoreTenths, a.maxMarks);
      weights += a.weight;
    }
  }
  if (weights === 0) {
    const status = missing ? "missing" : absent ? "absent" : exempt ? "exempt" : "missing";
    return { pctTenths: null, status, missing };
  }
  return { pctTenths: divRound(sum, weights), status: "ok", missing };
}

export type StudentSummary = {
  /** Subjects with a result. */
  count: number;
  /** Sum of the graded subject scores (tenths). */
  totalTenths: number;
  meanTenths: number | null;
  meanPointsHundredths: number | null;
  meanGrade: SchemeLevel | null;
};

/** Totals and means over the subjects that have a result (Absent/Exempt subjects left out). */
export function studentSummary(scheme: Scheme, subjectPcts: (number | null)[]): StudentSummary {
  const scored = subjectPcts.filter((p): p is number => p !== null);
  if (!scored.length) {
    return {
      count: 0,
      totalTenths: 0,
      meanTenths: null,
      meanPointsHundredths: null,
      meanGrade: null,
    };
  }
  const graded = scored.map((p) => gradedTenths(scheme, p));
  const total = graded.reduce((a, b) => a + b, 0);
  const points = scored.reduce((a, p) => a + (gradeFor(scheme, p)?.points ?? 0), 0);
  const meanPoints = divRound(points * 100, scored.length);
  return {
    count: scored.length,
    totalTenths: total,
    meanTenths: divRound(total, scored.length),
    meanPointsHundredths: meanPoints,
    meanGrade: meanGradeFor(scheme, meanPoints),
  };
}

/** Competition ranking (1, 2, 2, 4). Students with no results get no position. */
export function positions(
  rows: { id: string; meanPointsHundredths: number | null; meanTenths: number | null }[],
): Map<string, number> {
  const ranked = rows
    .filter((r) => r.meanPointsHundredths !== null && r.meanTenths !== null)
    .sort(
      (a, b) => b.meanPointsHundredths! - a.meanPointsHundredths! || b.meanTenths! - a.meanTenths!,
    );
  const out = new Map<string, number>();
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    const same =
      prev &&
      prev.meanPointsHundredths === r.meanPointsHundredths &&
      prev.meanTenths === r.meanTenths;
    out.set(r.id, same ? out.get(prev.id)! : i + 1);
  });
  return out;
}

export type ParsedMark =
  { kind: "clear" } | { kind: "mark"; value: MarkValue } | { kind: "error"; message: string };

/**
 * What a teacher typed: a mark (up to one decimal place), "A" / "Abs" for Absent, "X" / "Ex" for
 * Exempt, or nothing (clears the mark). Marks above the maximum are refused.
 */
export function parseMark(raw: string, maxMarks: number): ParsedMark {
  const s = raw.trim().toLowerCase();
  if (s === "") return { kind: "clear" };
  if (["a", "ab", "abs", "absent"].includes(s))
    return { kind: "mark", value: { status: "absent", scoreTenths: null } };
  if (["x", "e", "ex", "exempt"].includes(s))
    return { kind: "mark", value: { status: "exempt", scoreTenths: null } };
  if (!/^\d+([.,]\d)?$/.test(s)) return { kind: "error", message: "Not a mark" };
  const tenths = Math.round(Number(s.replace(",", ".")) * 10);
  if (tenths > maxMarks * 10) return { kind: "error", message: `Above ${maxMarks}` };
  return { kind: "mark", value: { status: "score", scoreTenths: tenths } };
}

/** A stored mark as the teacher would type it ("73.5", "A", "X"). */
export function markText(m: MarkValue | null | undefined): string {
  if (!m) return "";
  if (m.status === "absent") return "A";
  if (m.status === "exempt") return "X";
  return formatTenths(m.scoreTenths ?? 0);
}

/** 735 → "73.5"; 730 → "73". */
export function formatTenths(t: number) {
  return t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1);
}

/** 725 → "7.25"; for mean points. */
export function formatHundredths(h: number) {
  return (h / 100).toFixed(2);
}

export type WeightPlan = {
  assessments: { name: string; weight: number; overrides: Record<string, number> }[];
  subjects: { id: string; name: string }[];
};

/** Each subject's weights must add up to 100. Returns the subjects that don't, with totals. */
export function weightProblems(plan: WeightPlan): { subject: string; total: number }[] {
  if (!plan.assessments.length) return [];
  const out: { subject: string; total: number }[] = [];
  for (const s of plan.subjects) {
    const total = plan.assessments.reduce((sum, a) => sum + (a.overrides[s.id] ?? a.weight), 0);
    if (total !== 100) out.push({ subject: s.name, total });
  }
  return out;
}

/** The weight an assessment carries for a subject. */
export function weightFor(
  a: { weight: number; overrides?: ReadonlyMap<string, number> | Record<string, number> },
  subjectId: string,
) {
  const o = a.overrides;
  const v =
    o instanceof Map ? o.get(subjectId) : (o as Record<string, number> | undefined)?.[subjectId];
  return v ?? a.weight;
}
