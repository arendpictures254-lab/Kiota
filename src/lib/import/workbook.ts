/**
 * Build the import template (.xlsx) and read uploaded files back into plain rows.
 */
import ExcelJS from "exceljs";
import { type Column, SHEETS, type SheetDef, normaliseHeader } from "./columns";

const TEAL = "FF1F5F63";
const CREAM = "FFFBF7F0";
const MAX_ROWS = 2000;

export type TemplateLists = { levels: string[]; classes: string[] };
export type CellValue = string | number | null;
export type RawRow = { row: number; values: Record<string, CellValue> };
export type SheetRows = Record<SheetDef["name"], RawRow[]>;

/** Build the template. `fill` adds data rows (used for the sample files and tests). */
export async function buildWorkbook(
  lists: TemplateLists,
  fill?: Partial<Record<SheetDef["name"], Record<string, CellValue>[]>>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kiota";
  wb.created = new Date(0);

  writeReadme(wb.addWorksheet("README"));

  for (const def of SHEETS) {
    const ws = wb.addWorksheet(def.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = def.columns.map((c) => ({
      header: c.required ? `${c.header} *` : c.header,
      key: c.key,
      width: c.width ?? 16,
      style: c.text ? { numFmt: "@" } : c.date ? { numFmt: "dd/mm/yyyy" } : {},
    }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    header.height = 22;

    for (const row of fill?.[def.name] ?? []) {
      const values: Record<string, unknown> = {};
      for (const c of def.columns) {
        const v = row[c.key];
        values[c.key] =
          c.date && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
            ? new Date(`${v}T00:00:00Z`)
            : (v ?? null);
      }
      ws.addRow(values);
    }

    def.columns.forEach((c, i) => addDropdown(ws, i + 1, c));
  }

  const listSheet = wb.addWorksheet("Lists", { state: "hidden" });
  listSheet.getColumn(1).values = ["Levels", ...lists.levels];
  listSheet.getColumn(2).values = ["Classes", ...lists.classes];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function listRange(list: string): string {
  const col = list === "Levels" ? "A" : "B";
  return `Lists!$${col}$2:$${col}$200`;
}

function addDropdown(ws: ExcelJS.Worksheet, colIndex: number, c: Column) {
  if (!c.dropdown && !c.date) return;
  for (let r = 2; r <= MAX_ROWS; r++) {
    const cell = ws.getCell(r, colIndex);
    if (c.dropdown) {
      cell.dataValidation = {
        type: "list",
        allowBlank: !c.required,
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: c.header,
        error: "Choose a value from the list.",
        formulae: [
          "list" in c.dropdown ? listRange(c.dropdown.list) : `"${c.dropdown.options.join(",")}"`,
        ],
      };
    }
  }
}

function writeReadme(ws: ExcelJS.Worksheet) {
  ws.columns = [{ width: 28 }, { width: 12 }, { width: 70 }, { width: 22 }];
  const title = ws.addRow(["Kiota import template"]);
  title.font = { bold: true, size: 16, color: { argb: TEAL } };
  ws.addRow([]);
  for (const line of [
    "1. Fill the Classes sheet if you need new streams (optional).",
    "2. Fill the Students sheet: one row per student.",
    "3. Fill the Guardians sheet: one row per guardian per student.",
    "4. Upload the file in Kiota. You will see every problem before anything is saved.",
    "Columns marked * are required. Do not rename the sheets. You may delete example text.",
    "Uploading the same file again updates students; it never creates duplicates.",
  ]) {
    ws.addRow([line]);
  }
  for (const def of SHEETS) {
    ws.addRow([]);
    const h = ws.addRow([`${def.name} sheet`]);
    h.font = { bold: true, size: 13, color: { argb: TEAL } };
    ws.addRow([def.intro]).getCell(1).alignment = { wrapText: false };
    const head = ws.addRow(["Column", "Required", "What to enter", "Example"]);
    head.font = { bold: true };
    head.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    });
    for (const c of def.columns) {
      const r = ws.addRow([c.header, c.required ? "Yes" : "", c.help, c.example]);
      r.getCell(3).alignment = { wrapText: true, vertical: "top" };
    }
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ReadProblem = { sheet: string; message: string; fix: string };

function cellToValue(v: ExcelJS.CellValue, column: Column): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (column.key === "openingBalance") return v;
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellToValue(v.result as ExcelJS.CellValue, column);
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function readWorkbook(
  bytes: Buffer,
): Promise<{ sheets: SheetRows; problems: ReadProblem[] }> {
  const wb = new ExcelJS.Workbook();
  const problems: ReadProblem[] = [];
  const sheets: SheetRows = { Classes: [], Students: [], Guardians: [] };
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    problems.push({
      sheet: "File",
      message: "This file could not be read as an Excel workbook.",
      fix: "Download the Kiota template, fill it in and save it as .xlsx.",
    });
    return { sheets, problems };
  }

  for (const def of SHEETS) {
    const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === def.name.toLowerCase());
    if (!ws) {
      if (def.name !== "Classes") {
        problems.push({
          sheet: def.name,
          message: `The ${def.name} sheet is missing.`,
          fix: "Use the Kiota template and keep the sheet names unchanged.",
        });
      }
      continue;
    }
    const colIndex = new Map<string, number>();
    ws.getRow(1).eachCell((cell, i) => {
      const h = normaliseHeader(
        String(cellToValue(cell.value, { key: "", header: "", help: "", example: "" }) ?? ""),
      );
      const col = def.columns.find((c) => normaliseHeader(c.header) === h);
      if (col) colIndex.set(col.key, i);
    });
    const missing = def.columns.filter((c) => c.required && !colIndex.has(c.key));
    if (missing.length) {
      problems.push({
        sheet: def.name,
        message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((c) => c.header).join(", ")}.`,
        fix: "Use the Kiota template and keep the column headings unchanged.",
      });
      continue;
    }
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, CellValue> = {};
      let any = false;
      for (const c of def.columns) {
        const i = colIndex.get(c.key);
        const v = i ? cellToValue(row.getCell(i).value, c) : null;
        const cleaned = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v;
        values[c.key] = cleaned;
        if (cleaned !== null) any = true;
      }
      if (any) sheets[def.name].push({ row: rowNumber, values });
    });
  }
  return { sheets, problems };
}
