/**
 * Receipt and statement PDFs. Brand rule: on anything a school hands to parents, the school's
 * own name and crest come first and Kiota appears small, as "Powered by kiota". Thermal
 * receipts use the black logo only, at least 40 mm wide.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { APP_URL } from "@/lib/hosts";
import { kes, receiptNo } from "./allocation";
import type { ReceiptView, StatementView } from "./receipts";

const MM = 72 / 25.4;
const TEAL = "#1F5F63";
const INK = "#1E2422";
const MUTED = "#5b6360";
const OVERDUE = "#C0392B";

const asset = (...p: string[]) => path.join(process.cwd(), ...p);
let fonts: { regular: Buffer; bold: Buffer; heading: Buffer } | null = null;
function loadFonts() {
  fonts ??= {
    regular: readFileSync(asset("assets", "fonts", "dm-sans-latin-400-normal.woff")),
    bold: readFileSync(asset("assets", "fonts", "dm-sans-latin-700-normal.woff")),
    heading: readFileSync(asset("assets", "fonts", "syne-latin-700-normal.woff")),
  };
  return fonts;
}
const logo = (file: string) => readFileSync(asset("public", "brand", file));

function newDoc(size: [number, number] | "A4", margin: number) {
  const doc = new PDFDocument({
    size,
    margin,
    info: { Title: "Receipt", Producer: "Kiota", Creator: "Kiota" },
  });
  const f = loadFonts();
  doc.registerFont("body", f.regular);
  doc.registerFont("bold", f.bold);
  doc.registerFont("heading", f.heading);
  doc.font("body");
  return doc;
}

function finish(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

const date = (d: Date) =>
  d.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const shareUrl = (token: string) => `${APP_URL.replace(/^https?:\/\//, "")}/r/${token}`;

/** 80 mm thermal receipt (black only), exactly as long as its content (no wasted paper). */
export async function thermalReceiptPdf(r: ReceiptView, crest: Buffer | null) {
  // First pass on a very long page to measure, second pass at the measured length.
  const probe = newDoc([80 * MM, 1000 * MM], 4 * MM);
  const height = drawThermal(probe, r, crest) + 6 * MM;
  probe.end();
  const doc = newDoc([80 * MM, height], 4 * MM);
  drawThermal(doc, r, crest);
  return finish(doc);
}

function drawThermal(doc: PDFKit.PDFDocument, r: ReceiptView, crest: Buffer | null): number {
  const width = 80 * MM;
  const pad = 4 * MM;
  const w = width - pad * 2;
  doc.fillColor("black");
  if (crest) {
    doc.image(crest, (width - 18 * MM) / 2, doc.y, { fit: [18 * MM, 18 * MM], align: "center" });
    doc.y += 19 * MM;
  }
  doc.font("heading").fontSize(13).text(r.school.name.toUpperCase(), { align: "center", width: w });
  doc
    .moveDown(0.3)
    .font("bold")
    .fontSize(9.5)
    .text(`Official receipt No. ${receiptNo(r.number)}`, { align: "center", width: w });
  doc.font("body").fontSize(8).text(date(r.issuedAt), { align: "center", width: w });
  const rule = () => {
    doc.moveDown(0.5);
    doc
      .moveTo(pad, doc.y)
      .lineTo(width - pad, doc.y)
      .dash(2, { space: 2 })
      .stroke()
      .undash();
    doc.moveDown(0.5);
  };
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc
      .font("body")
      .fontSize(8.5)
      .text(label, pad, y, { width: w * 0.42 });
    doc
      .font(bold ? "bold" : "body")
      .text(value, pad + w * 0.42, y, { width: w * 0.58, align: "right" });
    doc.moveDown(0.15);
  };
  rule();
  row("Student", r.student.name, true);
  row("Adm", r.student.admissionNumber);
  row("Class", r.student.className);
  rule();
  row("Paid", kes(r.amountCents), true);
  row("Method", r.methodLabel);
  if (r.reference) row("Reference", r.reference);
  if (r.payerName) row("Paid by", r.payerName);
  row("Date paid", day(r.paidAt));
  if (r.allocation.length) {
    rule();
    for (const a of r.allocation) row(a.voteHead, kes(a.amountCents));
  }
  rule();
  doc.font("heading").fontSize(11);
  const y = doc.y;
  doc.text("Balance", pad, y, { width: w / 2 });
  doc.text(kes(r.balanceAfterCents), pad + w / 2, y, { width: w / 2, align: "right" });
  doc.moveDown(0.6);
  if (r.servedBy)
    doc
      .font("body")
      .fontSize(8)
      .text(`Served by ${r.servedBy}`, pad, doc.y, { width: w, align: "center" });
  if (r.reversal) {
    doc.moveDown(0.5).font("heading").fontSize(12).text("REVERSED", { align: "center", width: w });
    doc.font("body").fontSize(8).text(r.reversal.reason, { align: "center", width: w });
  }
  if (r.shareToken)
    doc
      .moveDown(0.6)
      .font("body")
      .fontSize(7.5)
      .text(`Check: ${shareUrl(r.shareToken)}`, { align: "center", width: w });
  doc.moveDown(0.8).font("body").fontSize(7).text("Powered by", { align: "center", width: w });
  const logoW = 40 * MM;
  const logoY = doc.y + 2;
  doc.image(logo("kiota-logo-horizontal-mono-black@2x.png"), (width - logoW) / 2, logoY, {
    width: logoW,
  });
  return logoY + logoW * (200 / 693); // logo aspect ratio
}

/** A4 receipt: the school leads, Kiota signs off small. */
export async function a4ReceiptPdf(r: ReceiptView, crest: Buffer | null) {
  const doc = newDoc("A4", 50);
  const left = 50;
  const right = doc.page.width - 50;
  const w = right - left;
  let x = left;
  if (crest) {
    doc.image(crest, left, 50, { fit: [56, 56] });
    x = left + 68;
  }
  doc
    .fillColor(INK)
    .font("heading")
    .fontSize(20)
    .text(r.school.name, x, 54, { width: right - x });
  doc
    .font("body")
    .fontSize(11)
    .fillColor(MUTED)
    .text("Official receipt", x, doc.y + 2);
  doc
    .font("heading")
    .fontSize(16)
    .fillColor(TEAL)
    .text(`No. ${receiptNo(r.number)}`, left, 54, { width: w, align: "right" });
  doc
    .font("body")
    .fontSize(10)
    .fillColor(MUTED)
    .text(date(r.issuedAt), left, 76, { width: w, align: "right" });

  let y = 130;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dddddd").stroke();
  y += 16;
  const pair = (label: string, value: string, col: 0 | 1) => {
    const cx = left + col * (w / 2);
    doc.font("body").fontSize(9).fillColor(MUTED).text(label.toUpperCase(), cx, y);
    doc
      .font("bold")
      .fontSize(12)
      .fillColor(INK)
      .text(value, cx, y + 12, { width: w / 2 - 10 });
  };
  pair("Student", r.student.name, 0);
  pair("Admission number", r.student.admissionNumber, 1);
  y += 40;
  pair("Class", r.student.className, 0);
  pair("Date paid", day(r.paidAt), 1);
  y += 40;
  pair("Method", `${r.methodLabel}${r.reference ? ` · ${r.reference}` : ""}`, 0);
  pair("Paid by", r.payerName ?? "—", 1);
  y += 50;

  doc.font("bold").fontSize(10).fillColor(INK).text("Paid towards", left, y);
  doc.text("Amount", left, y, { width: w, align: "right" });
  y += 18;
  for (const a of r.allocation) {
    doc.font("body").fontSize(10.5).text(a.voteHead, left, y);
    doc.text(kes(a.amountCents), left, y, { width: w, align: "right" });
    y += 18;
  }
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dddddd").stroke();
  y += 10;
  doc.font("heading").fontSize(14).text("Total paid", left, y);
  doc.text(kes(r.amountCents), left, y, { width: w, align: "right" });
  y += 30;
  doc
    .font("heading")
    .fontSize(22)
    .fillColor(r.balanceAfterCents > 0 ? TEAL : INK)
    .text("Balance", left, y);
  doc.text(kes(r.balanceAfterCents), left, y, { width: w, align: "right" });
  y += 40;
  if (r.servedBy)
    doc.font("body").fontSize(10).fillColor(MUTED).text(`Served by ${r.servedBy}`, left, y);
  if (r.reversal) {
    y += 30;
    doc
      .font("heading")
      .fontSize(26)
      .fillColor(OVERDUE)
      .text("REVERSED", left, y, { width: w, align: "center" });
    doc
      .font("body")
      .fontSize(10)
      .text(r.reversal.reason, left, y + 32, { width: w, align: "center" });
  }

  const foot = doc.page.height - 80;
  if (r.shareToken) {
    doc
      .font("body")
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Check this receipt: ${shareUrl(r.shareToken)}`, left, foot, { width: w * 0.6 });
  }
  doc
    .font("body")
    .fontSize(8)
    .fillColor(MUTED)
    .text("Powered by", right - 120, foot - 2, { width: 52, align: "right" });
  doc.image(logo("kiota-logo-horizontal@2x.png"), right - 64, foot - 6, { width: 64 });
  return finish(doc);
}

/** A4 fee statement with a running balance. */
export async function statementPdf(s: NonNullable<StatementView>, crest: Buffer | null) {
  const doc = newDoc("A4", 50);
  const left = 50;
  const right = doc.page.width - 50;
  const w = right - left;
  let x = left;
  if (crest) {
    doc.image(crest, left, 50, { fit: [48, 48] });
    x = left + 60;
  }
  doc
    .fillColor(INK)
    .font("heading")
    .fontSize(18)
    .text(s.school.name, x, 52, { width: right - x });
  doc
    .font("body")
    .fontSize(11)
    .fillColor(MUTED)
    .text("Fee statement", x, doc.y + 2);
  doc
    .font("bold")
    .fontSize(11)
    .fillColor(INK)
    .text(s.student.name, left, 52, { width: w, align: "right" });
  doc
    .font("body")
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${s.student.admissionNumber} · ${s.student.className}`, left, 68, {
      width: w,
      align: "right",
    });
  doc.text(`Printed ${day(new Date())}`, left, 82, { width: w, align: "right" });

  const cols = [left, left + 70, left + 290, left + 360, left + 430];
  let y = 120;
  const header = () => {
    doc.font("bold").fontSize(9).fillColor(INK);
    ["Date", "Description", "Charged", "Paid", "Balance"].forEach((h, i) =>
      doc.text(h, cols[i], y, {
        width: i < 2 ? (i === 0 ? 65 : 215) : 65,
        align: i < 2 ? "left" : "right",
      }),
    );
    y += 16;
    doc
      .moveTo(left, y - 3)
      .lineTo(right, y - 3)
      .strokeColor("#dddddd")
      .stroke();
  };
  header();
  doc.font("body").fontSize(9);
  for (const r of s.rows) {
    if (y > doc.page.height - 110) {
      doc.addPage();
      y = 60;
      header();
      doc.font("body").fontSize(9);
    }
    const desc = r.receiptNumber
      ? `${r.description} (receipt ${receiptNo(r.receiptNumber)})`
      : r.description;
    const h = Math.max(14, doc.heightOfString(desc, { width: 215 }) + 4);
    doc.fillColor(INK).text(day(r.date), cols[0], y, { width: 65 });
    doc.text(desc, cols[1], y, { width: 215 });
    doc.text(r.debitCents ? kes(r.debitCents) : "", cols[2], y, { width: 65, align: "right" });
    doc.text(r.creditCents ? kes(r.creditCents) : "", cols[3], y, { width: 65, align: "right" });
    doc.text(kes(r.balanceCents), cols[4], y, { width: 65, align: "right" });
    y += h;
  }
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#dddddd").stroke();
  y += 12;
  doc
    .font("heading")
    .fontSize(16)
    .fillColor(s.balanceCents > 0 ? TEAL : INK)
    .text("Balance", left, y);
  doc.text(kes(s.balanceCents), left, y, { width: w, align: "right" });

  const foot = doc.page.height - 70;
  doc
    .font("body")
    .fontSize(8)
    .fillColor(MUTED)
    .text("Powered by", right - 120, foot - 2, { width: 52, align: "right" });
  doc.image(logo("kiota-logo-horizontal@2x.png"), right - 64, foot - 6, { width: 64 });
  return finish(doc);
}
