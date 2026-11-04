import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook, readWorkbook } from "./workbook";

const lists = { levels: ["Junior School"], classes: ["Grade 7", "Grade 8"] };

describe("the import template", () => {
  it("has a README, the three data sheets and dropdowns", async () => {
    const bytes = await buildWorkbook(lists);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "README",
      "Classes",
      "Students",
      "Guardians",
      "Lists",
    ]);
    const students = wb.getWorksheet("Students")!;
    expect(students.getRow(1).getCell(1).value).toBe("Admission number *");
    expect(students.getCell("F2").dataValidation).toMatchObject({ type: "list" });
    const readme = wb.getWorksheet("README")!;
    const text = readme.getSheetValues().flat().join(" ");
    expect(text).toContain("Opening fee balance (KES)");
    expect(text).toContain("0712 345 678");
  });

  it("reads back what was written, including dates and numeric phones", async () => {
    const bytes = await buildWorkbook(lists, {
      Students: [
        {
          admissionNumber: "BA/1",
          firstName: "Achieng",
          lastName: "Otieno",
          gender: "Female",
          dateOfBirth: "2014-03-14",
          class: "Grade 7",
          stream: "East",
          boarding: "Day",
          openingBalance: 12500.5,
        },
      ],
      Guardians: [
        { admissionNumber: "BA/1", name: "Mary", phone: 712345678, relationship: "Mother" },
      ],
    });
    const { sheets, problems } = await readWorkbook(bytes);
    expect(problems).toEqual([]);
    expect(sheets.Students[0]).toMatchObject({
      row: 2,
      values: { admissionNumber: "BA/1", dateOfBirth: "2014-03-14", openingBalance: 12500.5 },
    });
    expect(sheets.Guardians[0].values.phone).toBe("712345678");
    expect(sheets.Classes).toEqual([]);
  });

  it("reports a file that is not Excel", async () => {
    const { problems } = await readWorkbook(Buffer.from("not a spreadsheet"));
    expect(problems[0].message).toMatch(/could not be read/);
  });
});
