/**
 * Student ID card PDFs, CR80 size (85.6 × 54 mm), front and back.
 *  - A4 sheets: 8 cards per page with crop marks for cutting and laminating; each page of fronts
 *    is followed by its backs, mirrored, so a long-edge duplex print lines them up.
 *  - Single cards for PVC card printers: one page per side, at card size.
 * Brand rule: the school's crest and name come first; "Powered by kiota" is small, on the back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { PrintCard } from "./service";

const MM = 72 / 25.4;
export const CARD_MM = { width: 85.6, height: 54 } as const;
const W = CARD_MM.width * MM;
const H = CARD_MM.height * MM;
const TEAL = "#1F5F63";
const CREAM = "#FBF7F0";
const INK = "#1E2422";
const MUTED = "#5b6360";

type School = {
  name: string;
  crest: { bytes: Buffer; contentType: string } | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

const asset = (...p: string[]) => path.join(process.cwd(), ...p);
let fonts: { regular: Buffer; bold: Buffer; heading: Buffer; logo: Buffer } | null = null;
function assets() {
  fonts ??= {
    regular: readFileSync(asset("assets", "fonts", "dm-sans-latin-400-normal.woff")),
    bold: readFileSync(asset("assets", "fonts", "dm-sans-latin-700-normal.woff")),
    heading: readFileSync(asset("assets", "fonts", "syne-latin-700-normal.woff")),
    logo: readFileSync(asset("public", "brand", "kiota-logo-horizontal@2x.png")),
  };
  return fonts;
}

function newDoc(size: [number, number]) {
  const doc = new PDFDocument({
    size,
    margin: 0,
    autoFirstPage: false,
    info: { Title: "Student ID cards", Producer: "Kiota", Creator: "Kiota" },
  });
  const a = assets();
  doc.registerFont("body", a.regular);
  doc.registerFont("bold", a.bold);
  doc.registerFont("heading", a.heading);
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

const qrPng = (token: string) =>
  QRCode.toBuffer(token, { errorCorrectionLevel: "M", margin: 1, scale: 6, type: "png" });

function one(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number) {
  doc.text(text, x, y, { width, lineBreak: false, ellipsis: true });
}

async function front(doc: PDFKit.PDFDocument, x: number, y: number, c: PrintCard, s: School) {
  doc.save();
  doc.roundedRect(x, y, W, H, 3 * MM).clip();
  doc.rect(x, y, W, H).fill("#FFFFFF");
  // Header: crest and school name first.
  const band = 11 * MM;
  doc.rect(x, y, W, band).fill(TEAL);
  let textX = x + 3 * MM;
  if (s.crest) {
    try {
      doc.image(s.crest.bytes, x + 2.5 * MM, y + 1.5 * MM, { fit: [8 * MM, 8 * MM] });
      textX = x + 12 * MM;
    } catch {
      // an unreadable crest: the name alone
    }
  }
  doc.fillColor("#FFFFFF").font("heading").fontSize(8.5);
  one(doc, s.name, textX, y + 2.2 * MM, x + W - textX - 3 * MM);
  doc.font("body").fontSize(5.5).fillColor("#DDEFEC");
  one(doc, "STUDENT IDENTITY CARD", textX, y + 6.6 * MM, x + W - textX - 3 * MM);

  // Photo.
  const px = x + 3 * MM;
  const py = y + band + 2.5 * MM;
  const pw = 22 * MM;
  const ph = 27.5 * MM;
  doc.rect(px, py, pw, ph).fill(CREAM);
  if (c.photo) {
    try {
      doc.image(c.photo.bytes, px, py, { cover: [pw, ph], align: "center", valign: "center" });
    } catch {
      // no photo drawn
    }
  } else {
    doc
      .fillColor(MUTED)
      .font("body")
      .fontSize(6)
      .text("No photo", px, py + ph / 2 - 3, {
        width: pw,
        align: "center",
      });
  }

  // Details.
  const dx = px + pw + 3 * MM;
  const qr = 17 * MM;
  const dw = x + W - dx - 3 * MM;
  let ty = py;
  doc.fillColor(INK).font("bold").fontSize(9);
  doc.text(c.name, dx, ty, { width: dw, height: 9 * MM, ellipsis: true });
  ty += doc.heightOfString(c.name, { width: dw }) > 12 ? 9 * MM : 5 * MM;
  const row = (label: string, value: string) => {
    doc.font("body").fontSize(5.5).fillColor(MUTED);
    one(doc, label, dx, ty, dw - qr);
    doc.font("bold").fontSize(7).fillColor(INK);
    one(doc, value, dx, ty + 2.2 * MM, dw - qr - 1 * MM);
    ty += 5.6 * MM;
  };
  row("Admission no.", c.admissionNumber);
  row("Class", c.classLabel);
  row(c.boarder ? "Boarder" : "Day scholar", `Valid until ${c.validUntilYear}`);

  // QR code: a signed token naming only this card.
  doc.image(await qrPng(c.token), x + W - qr - 2.5 * MM, y + H - qr - 2.5 * MM, {
    width: qr,
    height: qr,
  });
  doc.restore();
  doc
    .roundedRect(x, y, W, H, 3 * MM)
    .lineWidth(0.3)
    .strokeColor("#D7D2C8")
    .stroke();
}

function back(doc: PDFKit.PDFDocument, x: number, y: number, s: School) {
  doc.save();
  doc.roundedRect(x, y, W, H, 3 * MM).clip();
  doc.rect(x, y, W, H).fill(CREAM);
  doc.rect(x, y, W, 3 * MM).fill(TEAL);
  const ix = x + 5 * MM;
  const iw = W - 10 * MM;
  let ty = y + 7 * MM;
  doc.fillColor(INK).font("bold").fontSize(7.5);
  doc.text("If found, please return to:", ix, ty, { width: iw });
  ty += 4.5 * MM;
  doc.font("heading").fontSize(9).fillColor(TEAL);
  one(doc, s.name, ix, ty, iw);
  ty += 5 * MM;
  doc.font("body").fontSize(7).fillColor(INK);
  for (const line of [s.address, s.phone ? `Phone: ${s.phone}` : null, s.email]) {
    if (!line) continue;
    one(doc, line, ix, ty, iw);
    ty += 3.8 * MM;
  }
  doc.font("body").fontSize(5.5).fillColor(MUTED);
  doc.text(
    "This card belongs to the school. It is for identification only and is not a gate pass.",
    ix,
    y + H - 14 * MM,
    { width: iw - 22 * MM },
  );
  // Powered by kiota, small.
  doc.font("body").fontSize(5).fillColor(MUTED);
  doc.text("Powered by", x + W - 25 * MM, y + H - 6.2 * MM, { width: 10 * MM, align: "right" });
  doc.image(assets().logo, x + W - 14.5 * MM, y + H - 6.8 * MM, { height: 3 * MM });
  doc.restore();
  doc
    .roundedRect(x, y, W, H, 3 * MM)
    .lineWidth(0.3)
    .strokeColor("#D7D2C8")
    .stroke();
}

/** Short crop marks outside each corner, in the gaps between cards. */
function cropMarks(doc: PDFKit.PDFDocument, x: number, y: number) {
  const gap = 1.5 * MM;
  const len = 3 * MM;
  doc.save().lineWidth(0.25).strokeColor("#000000");
  for (const [cx, cy] of [
    [x, y],
    [x + W, y],
    [x, y + H],
    [x + W, y + H],
  ] as const) {
    const sx = cx === x ? -1 : 1;
    const sy = cy === y ? -1 : 1;
    doc
      .moveTo(cx + sx * gap, cy)
      .lineTo(cx + sx * (gap + len), cy)
      .stroke();
    doc
      .moveTo(cx, cy + sy * gap)
      .lineTo(cx, cy + sy * (gap + len))
      .stroke();
  }
  doc.restore();
}

export const PER_SHEET = 8;

/** A4 sheets: 2 columns × 4 rows; fronts, then the same page of backs mirrored. */
export async function cardSheetsPdf(school: School, cards: PrintCard[]) {
  const doc = newDoc([210 * MM, 297 * MM]);
  const cols = 2;
  const rows = 4;
  const gapX = 10 * MM;
  const gapY = 10 * MM;
  const left = (210 * MM - (cols * W + (cols - 1) * gapX)) / 2;
  const top = (297 * MM - (rows * H + (rows - 1) * gapY)) / 2;
  const at = (col: number, row: number) =>
    [left + col * (W + gapX), top + row * (H + gapY)] as const;
  for (let i = 0; i < cards.length; i += PER_SHEET) {
    const page = cards.slice(i, i + PER_SHEET);
    doc.addPage();
    doc.font("body").fontSize(7).fillColor(MUTED);
    doc.text(
      `${school.name} · student ID cards · fronts · sheet ${i / PER_SHEET + 1}`,
      10 * MM,
      8 * MM,
    );
    for (const [k, c] of page.entries()) {
      const [x, y] = at(k % cols, Math.floor(k / cols));
      cropMarks(doc, x, y);
      await front(doc, x, y, c, school);
    }
    doc.addPage();
    doc.font("body").fontSize(7).fillColor(MUTED);
    doc.text(`${school.name} · backs (print on the reverse, long edge)`, 10 * MM, 8 * MM);
    for (const [k] of page.entries()) {
      // Mirrored: the back of the left card prints on the right.
      const [x, y] = at(cols - 1 - (k % cols), Math.floor(k / cols));
      cropMarks(doc, x, y);
      back(doc, x, y, school);
    }
  }
  return finish(doc);
}

/** One page per side at card size, for PVC card printers. */
export async function singleCardsPdf(school: School, cards: PrintCard[]) {
  const doc = newDoc([W, H]);
  for (const c of cards) {
    doc.addPage();
    await front(doc, 0, 0, c, school);
    doc.addPage();
    back(doc, 0, 0, school);
  }
  return finish(doc);
}
