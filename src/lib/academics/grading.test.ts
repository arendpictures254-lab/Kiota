import { describe, expect, it } from "vitest";
import {
  type Scheme,
  gradeFor,
  meanGradeFor,
  parseMark,
  positions,
  studentSummary,
  subjectResult,
  weightProblems,
} from "./grading";

// The defaults kiota_academic_defaults() copies to every school.
const junior: Scheme = {
  roundMarks: true,
  levels: [
    { code: "EE1", label: "Exceptional", points: 8, minMark: 90, maxMark: 100 },
    { code: "EE2", label: "Very good", points: 7, minMark: 75, maxMark: 89 },
    { code: "ME1", label: "Good", points: 6, minMark: 58, maxMark: 74 },
    { code: "ME2", label: "Fair", points: 5, minMark: 41, maxMark: 57 },
    { code: "AE1", label: "Needs improvement", points: 4, minMark: 31, maxMark: 40 },
    { code: "AE2", label: "Below average", points: 3, minMark: 21, maxMark: 30 },
    { code: "BE1", label: "Well below average", points: 2, minMark: 11, maxMark: 20 },
    { code: "BE2", label: "Minimal", points: 1, minMark: 0, maxMark: 10 },
  ],
};
const kcse: Scheme = {
  roundMarks: true,
  levels: [
    ["A", 12, 80],
    ["A-", 11, 75],
    ["B+", 10, 70],
    ["B", 9, 65],
    ["B-", 8, 60],
    ["C+", 7, 55],
    ["C", 6, 50],
    ["C-", 5, 45],
    ["D+", 4, 40],
    ["D", 3, 35],
    ["D-", 2, 30],
    ["E", 1, 0],
  ].map(([code, points, min], i, all) => ({
    code: String(code),
    label: String(code),
    points: Number(points),
    minMark: Number(min),
    maxMark: i === 0 ? 100 : Number(all[i - 1][2]) - 1,
  })),
};

describe("level and grade boundaries", () => {
  it("grades the junior school 8-level scale at its edges", () => {
    const code = (pct: number) => gradeFor(junior, Math.round(pct * 10))?.code;
    expect(code(100)).toBe("EE1");
    expect(code(90)).toBe("EE1");
    expect(code(89.5)).toBe("EE1"); // rounded to 90 first
    expect(code(89.4)).toBe("EE2");
    expect(code(89)).toBe("EE2");
    expect(code(75)).toBe("EE2");
    expect(code(74.4)).toBe("ME1");
    expect(code(58)).toBe("ME1");
    expect(code(57)).toBe("ME2");
    expect(code(41)).toBe("ME2");
    expect(code(40)).toBe("AE1");
    expect(code(11)).toBe("BE1");
    expect(code(10)).toBe("BE2");
    expect(code(0)).toBe("BE2");
  });

  it("without rounding, 89.5 stays below 90", () => {
    expect(gradeFor({ ...junior, roundMarks: false }, 895)?.code).toBe("EE2");
    expect(gradeFor({ ...junior, roundMarks: false }, 900)?.code).toBe("EE1");
  });

  it("grades KCSE marks", () => {
    expect(gradeFor(kcse, 800)?.code).toBe("A");
    expect(gradeFor(kcse, 795)?.code).toBe("A"); // 79.5 rounds to 80
    expect(gradeFor(kcse, 794)?.code).toBe("A-");
    expect(gradeFor(kcse, 290)?.code).toBe("E");
  });
});

describe("KCSE mean grade from points", () => {
  it("rounds mean points half up to a whole point", () => {
    expect(meanGradeFor(kcse, 1200)?.code).toBe("A");
    expect(meanGradeFor(kcse, 1150)?.code).toBe("A");
    expect(meanGradeFor(kcse, 1149)?.code).toBe("A-");
    expect(meanGradeFor(kcse, 750)?.code).toBe("B-");
    expect(meanGradeFor(kcse, 749)?.code).toBe("C+");
    expect(meanGradeFor(kcse, 100)?.code).toBe("E");
  });

  it("averages the points of the subjects, not the marks", () => {
    // A (12), B (9), C (6): mean points 9.00 = B, although the mean mark is 66.7 (B too)
    const s = studentSummary(kcse, [850, 670, 520]);
    expect(s.meanPointsHundredths).toBe(900);
    expect(s.meanGrade?.code).toBe("B");
    expect(s.count).toBe(3);
    expect(s.totalTenths).toBe(850 + 670 + 520);
    // A, A, E: mean points 8.33 → B-; the mean mark 63.3 alone would say B-
    expect(studentSummary(kcse, [900, 900, 100]).meanGrade?.code).toBe("B-");
  });
});

describe("weighted subject results", () => {
  const a = [
    { id: "cat1", maxMarks: 30, weight: 20 },
    { id: "cat2", maxMarks: 30, weight: 20 },
    { id: "end", maxMarks: 100, weight: 60 },
  ];
  it("weights the assessments as percentages", () => {
    const r = subjectResult(
      a,
      new Map([
        ["cat1", { status: "score", scoreTenths: 300 }], // 100%
        ["cat2", { status: "score", scoreTenths: 150 }], // 50%
        ["end", { status: "score", scoreTenths: 700 }], // 70%
      ] as const),
    );
    expect(r).toEqual({ pctTenths: 720, status: "ok", missing: 0 }); // 20+10+42
  });

  it("leaves Absent and Exempt out of the average instead of counting zero", () => {
    const r = subjectResult(
      a,
      new Map([
        ["cat1", { status: "absent", scoreTenths: null }],
        ["cat2", { status: "score", scoreTenths: 150 }], // 50%
        ["end", { status: "score", scoreTenths: 700 }], // 70%
      ] as const),
    );
    // (20*50 + 60*70) / 80 = 65
    expect(r.pctTenths).toBe(650);
    const exempt = subjectResult(
      a,
      new Map(a.map((x) => [x.id, { status: "exempt" as const, scoreTenths: null }])),
    );
    expect(exempt).toEqual({ pctTenths: null, status: "exempt", missing: 0 });
  });

  it("leaves an Absent/Exempt subject out of the student's mean", () => {
    const s = studentSummary(junior, [800, null, 600]);
    expect(s.count).toBe(2);
    expect(s.meanTenths).toBe(700);
    // 80 = EE2 (7), 60 = ME1 (6): mean points 6.50 → 7 = EE2
    expect(s.meanPointsHundredths).toBe(650);
    expect(s.meanGrade?.code).toBe("EE2");
  });

  it("flags marks not yet entered", () => {
    const r = subjectResult(a, new Map([["end", { status: "score", scoreTenths: 500 }]] as const));
    expect(r).toEqual({ pctTenths: 500, status: "ok", missing: 2 });
  });
});

describe("weights", () => {
  const subjects = [
    { id: "eng", name: "English" },
    { id: "art", name: "Creative Arts" },
  ];
  it("must add up to 100 for every subject", () => {
    expect(
      weightProblems({
        subjects,
        assessments: [
          { name: "CAT", weight: 30, overrides: {} },
          { name: "End-term", weight: 70, overrides: {} },
        ],
      }),
    ).toEqual([]);
    expect(
      weightProblems({
        subjects,
        assessments: [
          { name: "CAT", weight: 30, overrides: {} },
          { name: "End-term", weight: 60, overrides: {} },
        ],
      }),
    ).toEqual([
      { subject: "English", total: 90 },
      { subject: "Creative Arts", total: 90 },
    ]);
  });
  it("counts a subject's own weights", () => {
    expect(
      weightProblems({
        subjects,
        assessments: [
          { name: "CAT", weight: 30, overrides: {} },
          { name: "End-term", weight: 70, overrides: { art: 40 } },
          { name: "Project", weight: 0, overrides: { art: 30 } },
        ],
      }),
    ).toEqual([]);
  });
});

describe("mark entry", () => {
  it("accepts marks, Absent and Exempt, and refuses marks above the maximum", () => {
    expect(parseMark("27.5", 30)).toEqual({
      kind: "mark",
      value: { status: "score", scoreTenths: 275 },
    });
    expect(parseMark("30", 30).kind).toBe("mark");
    expect(parseMark("31", 30)).toEqual({ kind: "error", message: "Above 30" });
    expect(parseMark("A", 30)).toEqual({
      kind: "mark",
      value: { status: "absent", scoreTenths: null },
    });
    expect(parseMark("x", 30)).toEqual({
      kind: "mark",
      value: { status: "exempt", scoreTenths: null },
    });
    expect(parseMark("", 30)).toEqual({ kind: "clear" });
    expect(parseMark("-3", 30).kind).toBe("error");
    expect(parseMark("12.25", 30).kind).toBe("error");
  });
});

describe("positions", () => {
  it("ranks by mean points then mean score, ties sharing a place", () => {
    const p = positions([
      { id: "a", meanPointsHundredths: 700, meanTenths: 800 },
      { id: "b", meanPointsHundredths: 800, meanTenths: 850 },
      { id: "c", meanPointsHundredths: 700, meanTenths: 800 },
      { id: "d", meanPointsHundredths: 700, meanTenths: 790 },
      { id: "e", meanPointsHundredths: null, meanTenths: null },
    ]);
    expect(Object.fromEntries(p)).toEqual({ b: 1, a: 2, c: 2, d: 4 });
  });
});
