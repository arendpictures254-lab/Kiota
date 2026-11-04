import { describe, expect, it } from "vitest";
import { type ImportContext, type Issue, validateImport } from "./validate";
import type { CellValue, RawRow, SheetRows } from "./workbook";

const today = new Date("2026-12-01T00:00:00Z");

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    levels: [
      {
        key: "primary",
        name: "Primary",
        enabled: true,
        classes: [{ name: "Grade 6", streams: [] }],
      },
      {
        key: "junior",
        name: "Junior School",
        enabled: true,
        classes: [
          { name: "Grade 7", streams: ["East", "West"] },
          { name: "Grade 8", streams: [] },
        ],
      },
      {
        key: "senior",
        name: "Senior School",
        enabled: false,
        classes: [{ name: "Grade 10", streams: [] }],
      },
    ],
    houses: ["Simba"],
    staffPhones: new Map([["+254711000003", "membership-grace"]]),
    existingStudents: new Map(),
    canMedical: true,
    today,
    ...overrides,
  };
}

let rowNo = 2;
const rows = (list: Record<string, CellValue>[]): RawRow[] =>
  list.map((values) => ({ row: rowNo++, values }));

function student(over: Record<string, CellValue> = {}): Record<string, CellValue> {
  return {
    admissionNumber: `A${rowNo}`,
    firstName: "Achieng",
    lastName: "Otieno",
    gender: "Female",
    dateOfBirth: "2014-03-14",
    class: "Grade 7",
    stream: "East",
    boarding: "Boarder",
    ...over,
  };
}

function guardian(
  admissionNumber: string,
  over: Record<string, CellValue> = {},
): Record<string, CellValue> {
  return {
    admissionNumber,
    name: "Mary Otieno",
    phone: "0712345678",
    relationship: "Mother",
    ...over,
  };
}

function sheets(s: Partial<Record<keyof SheetRows, Record<string, CellValue>[]>>): SheetRows {
  rowNo = 2;
  return {
    Classes: rows(s.Classes ?? []),
    Students: rows(s.Students ?? []),
    Guardians: rows(s.Guardians ?? []),
  };
}

const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");
const warnings = (issues: Issue[]) => issues.filter((i) => i.severity === "warning");

describe("a clean file", () => {
  it("plans students and guardians with no issues", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "BA-1", openingBalance: "12,500" })],
        Guardians: [
          guardian("BA-1"),
          guardian("BA-1", { name: "John Otieno", phone: "+254722000111", relationship: "Father" }),
        ],
      }),
      ctx(),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.counts).toMatchObject({
      studentsNew: 1,
      guardianRows: 2,
      openingBalances: 1,
      errors: 0,
    });
    expect(plan.students[0]).toMatchObject({
      admissionNumber: "BA-1",
      className: "Grade 7",
      streamName: "East",
      boarder: true,
      dateOfBirth: "2014-03-14",
      openingBalanceCents: 1_250_000,
    });
    expect(plan.guardians[0]).toMatchObject({
      phone: "+254712345678",
      relationship: "mother",
      language: "en",
      authorisedToCollect: true,
    });
  });
});

describe("admission numbers", () => {
  it("errors on a duplicate within the file", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "X1" }), student({ admissionNumber: " x1 " })],
      }),
      ctx(),
    );
    expect(errors(plan.issues)[0]).toMatchObject({
      sheet: "Students",
      row: 3,
      column: "Admission number",
    });
    expect(errors(plan.issues)[0].message).toMatch(/used twice/);
  });

  it("errors when the number already belongs to a different child in Kiota", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "X1", firstName: "Brian" })],
        Guardians: [guardian("X1")],
      }),
      ctx({
        existingStudents: new Map([
          [
            "X1",
            {
              admissionNumber: "X1",
              firstName: "Achieng",
              lastName: "Otieno",
              guardianCount: 1,
              openingBalancePosted: false,
            },
          ],
        ]),
      }),
    );
    expect(errors(plan.issues)[0].message).toMatch(/already belongs to Achieng Otieno/);
  });

  it("updates the same child instead of duplicating (re-import)", () => {
    const plan = validateImport(
      sheets({ Students: [student({ admissionNumber: "x1" })] }),
      ctx({
        existingStudents: new Map([
          [
            "X1",
            {
              admissionNumber: "X1",
              firstName: "achieng",
              lastName: "OTIENO",
              guardianCount: 1,
              openingBalancePosted: false,
            },
          ],
        ]),
      }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.students[0]).toMatchObject({ action: "update", admissionNumber: "X1" });
    expect(plan.counts).toMatchObject({ studentsNew: 0, studentsUpdated: 1 });
  });

  it("errors when missing", () => {
    const plan = validateImport(sheets({ Students: [student({ admissionNumber: null })] }), ctx());
    expect(errors(plan.issues)[0].message).toMatch(/admission number is missing/);
  });
});

describe("phone numbers", () => {
  it.each([
    "0712345678",
    "0112345678",
    "712345678",
    "254712345678",
    "+254712345678",
    "0712 345 678",
  ])("normalises %s", (phone) => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "P1" })],
        Guardians: [guardian("P1", { phone })],
      }),
      ctx(),
    );
    expect(errors(plan.issues)).toEqual([]);
    expect(plan.guardians[0].phone).toMatch(/^\+254[17]\d{8}$/);
  });

  it("errors on missing or invalid numbers with a fix", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "P1" })],
        Guardians: [
          guardian("P1", { phone: "07123" }),
          guardian("P1", { phone: null, name: "Other" }),
        ],
      }),
      ctx(),
    );
    const errs = errors(plan.issues);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toMatchObject({ sheet: "Guardians", column: "Phone" });
    expect(errs[0].message).toMatch(/not a valid phone number/);
    expect(errs[0].fix).toMatch(/0712 345 678/);
    expect(errs[1].message).toMatch(/missing/);
  });

  it("errors when the same guardian is listed twice for one student", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "P1" })],
        Guardians: [guardian("P1"), guardian("P1", { phone: "+254712345678" })],
      }),
      ctx(),
    );
    expect(errors(plan.issues)[0].message).toMatch(/listed twice/);
  });
});

describe("classes and streams", () => {
  it("errors on an unknown class", () => {
    const plan = validateImport(sheets({ Students: [student({ class: "Grade 77" })] }), ctx());
    expect(errors(plan.issues)[0]).toMatchObject({ column: "Class" });
    expect(errors(plan.issues)[0].message).toMatch(/does not know the class "Grade 77"/);
  });

  it("explains when the class's level is switched off", () => {
    const plan = validateImport(
      sheets({ Students: [student({ class: "Grade 10", stream: null })] }),
      ctx(),
    );
    expect(errors(plan.issues)[0].fix).toMatch(/Senior School, which is switched off/);
  });

  it("errors on an unknown stream and lists the real ones", () => {
    const plan = validateImport(sheets({ Students: [student({ stream: "North" })] }), ctx());
    expect(errors(plan.issues)[0].message).toMatch(/no stream called "North"/);
    expect(errors(plan.issues)[0].fix).toMatch(/East, West/);
  });

  it("requires a stream when the class has streams", () => {
    const plan = validateImport(sheets({ Students: [student({ stream: null })] }), ctx());
    expect(errors(plan.issues)[0].message).toMatch(/has streams/);
  });

  it("accepts a stream added on the Classes sheet", () => {
    const plan = validateImport(
      sheets({
        Classes: [
          { level: "Junior School", class: "Grade 8", stream: "Blue", teacherPhone: "0711000003" },
        ],
        Students: [student({ admissionNumber: "C1", class: "Grade 8", stream: "blue" })],
        Guardians: [guardian("C1")],
      }),
      ctx(),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.streams[0]).toMatchObject({
      className: "Grade 8",
      streamName: "Blue",
      teacherMembershipId: "membership-grace",
      exists: false,
    });
    expect(plan.students[0].streamName).toBe("Blue");
  });

  it("errors when a class teacher phone is not staff", () => {
    const plan = validateImport(
      sheets({
        Classes: [
          { level: "Junior School", class: "Grade 8", stream: "Blue", teacherPhone: "0799999999" },
        ],
      }),
      ctx(),
    );
    expect(errors(plan.issues)[0].message).toMatch(/not on your staff list/);
  });
});

describe("dates of birth", () => {
  it.each([
    ["2030-01-01", /future/],
    ["1980-05-05", /older than 25/],
    ["2026-06-01", /younger than 2/],
    ["31/02/2014", /not a date/],
    [null, /missing/],
  ])("%s is rejected", (dob, message) => {
    const plan = validateImport(sheets({ Students: [student({ dateOfBirth: dob })] }), ctx());
    expect(errors(plan.issues)[0]).toMatchObject({ column: "Date of birth" });
    expect(errors(plan.issues)[0].message).toMatch(message);
  });
});

describe("guardians", () => {
  it("warns (does not error) when a student has no guardian", () => {
    const plan = validateImport(sheets({ Students: [student({ admissionNumber: "NG1" })] }), ctx());
    expect(errors(plan.issues)).toEqual([]);
    expect(warnings(plan.issues)[0].message).toMatch(/has no guardian/);
    expect(plan.students).toHaveLength(1);
  });

  it("does not warn when the student already has guardians in Kiota", () => {
    const plan = validateImport(
      sheets({ Students: [student({ admissionNumber: "G1" })] }),
      ctx({
        existingStudents: new Map([
          [
            "G1",
            {
              admissionNumber: "G1",
              firstName: "Achieng",
              lastName: "Otieno",
              guardianCount: 2,
              openingBalancePosted: false,
            },
          ],
        ]),
      }),
    );
    expect(plan.issues).toEqual([]);
  });

  it("errors when the guardian's student is unknown", () => {
    const plan = validateImport(sheets({ Guardians: [guardian("NOPE")] }), ctx());
    expect(errors(plan.issues)[0].message).toMatch(/No student has admission number NOPE/);
  });

  it("errors on unknown relationship, language and Yes/No values", () => {
    const plan = validateImport(
      sheets({
        Students: [student({ admissionNumber: "R1" })],
        Guardians: [
          guardian("R1", { relationship: "Uncle", language: "French", receivesFees: "Maybe" }),
        ],
      }),
      ctx(),
    );
    expect(errors(plan.issues).map((e) => e.column)).toEqual([
      "Relationship",
      "Language",
      "Receives fees",
    ]);
  });
});

describe("other columns", () => {
  it("errors on medical columns when the importer may not see medical records", () => {
    const plan = validateImport(
      sheets({ Students: [student({ medicalNotes: "Asthma" })] }),
      ctx({ canMedical: false }),
    );
    expect(errors(plan.issues)[0].message).toMatch(/not allowed to record medical/);
  });

  it("errors on a bad opening balance and warns on a new house", () => {
    const plan = validateImport(
      sheets({ Students: [student({ openingBalance: "lots", house: "Chui" })] }),
      ctx(),
    );
    expect(errors(plan.issues)[0]).toMatchObject({ column: "Opening fee balance (KES)" });
    expect(warnings(plan.issues).some((w) => /House "Chui" is new/.test(w.message))).toBe(true);
  });

  it("errors on gender and boarding values it does not understand", () => {
    const plan = validateImport(
      sheets({ Students: [student({ gender: "X", boarding: "Weekly" })] }),
      ctx(),
    );
    expect(errors(plan.issues).map((e) => e.column)).toEqual(["Gender", "Boarder or day"]);
  });

  it("reports missing sheets from the reader as errors", () => {
    const plan = validateImport(sheets({}), ctx(), [
      { sheet: "Students", message: "The Students sheet is missing.", fix: "Use the template." },
    ]);
    expect(plan.counts.errors).toBe(1);
  });
});
