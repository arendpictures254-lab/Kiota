/**
 * Report card PDFs (A4, one page per student; a stream prints as one PDF in admission-number
 * order). Brand rule: the school's crest and name come first; Kiota signs off small, as
 * "Powered by kiota". Two templates: "classic" (ruled table) and "modern" (colour band, soft
 * rows). Released cards carry a QR code to the verification page; anything earlier is marked
 * "Draft: not released".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { ReportBundle, ReportCardView } from "./reportcards";
import { verifyUrl } from "./reportcards";

const TEAL = "#1F5F63";
const EGG = "#A9DCD6";
const INK = "#1E2422";
const MUTED = "#5b6360";
const LINE = "#c9cfcd";
const CREAM = "#FBF7F0";
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
let kiotaLogo: Buffer | null = null;
const logo = () =>
  (kiotaLogo ??= readFileSync(asset("public", "brand", "kiota-logo-horizontal@2x.png")));

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const kes = (cents: number) =>
  `KES ${(Math.abs(cents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export async function reportCardsPdf(bundle: ReportBundle): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    autoFirstPage: false,
    info: {
      Title: `Report cards · ${bundle.stream.name} · ${bundle.term.label}`,
      Producer: "Kiota",
      Creator: "Kiota",
    },
  });
  const f = loadFonts();
  doc.registerFont("body", f.regular);
  doc.registerFont("bold", f.bold);
  doc.registerFont("heading", f.heading);
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const card of bundle.cards) {
    doc.addPage();
    const qr = card.token
      ? await QRCode.toBuffer(verifyUrl(card.token), {
          errorCorrectionLevel: "M",
          margin: 1,
          scale: 5,
          type: "png",
        })
      : null;
    drawCard(doc, bundle, card, qr);
  }
  if (!bundle.cards.length) {
    doc.addPage();
    doc.font("body").fontSize(12).text("No students in this stream.");
  }
  doc.end();
  return done;
}

function drawCard(doc: PDFKit.PDFDocument, b: ReportBundle, c: ReportCardView, qr: Buffer | null) {
  const modern = b.template === "modern";
  const L = 36;
  const W = doc.page.width - 72;
  const R = L + W;
  let y = 36;

  // ---- Header: the school first ----
  const headH = 70;
  if (modern) {
    doc.rect(0, 0, doc.page.width, headH + 36).fill(TEAL);
  }
  const headInk = modern ? "#ffffff" : TEAL;
  let textX = L;
  if (b.crest) {
    try {
      doc.image(b.crest, L, y, { fit: [60, 60] });
      textX = L + 70;
    } catch {
      // an unreadable crest: the name alone
    }
  }
  const photoW = 62;
  const photoH = 78;
  doc
    .font("heading")
    .fontSize(18)
    .fillColor(headInk)
    .text(b.school.name, textX, y + 2, { width: R - photoW - 12 - textX });
  doc
    .font("body")
    .fontSize(9.5)
    .fillColor(modern ? EGG : MUTED)
    .text(`${b.school.county} County`, textX, doc.y + 1);
  doc
    .font("bold")
    .fontSize(11)
    .fillColor(modern ? "#ffffff" : INK)
    .text(`Report card · ${b.term.label}`, textX, doc.y + 4);
  // Photo
  const px = R - photoW;
  if (c.photo) {
    try {
      doc.image(c.photo, px, y, { cover: [photoW, photoH], align: "center", valign: "center" });
    } catch {
      /* no photo drawn */
    }
  } else {
    doc
      .rect(px, y, photoW, photoH)
      .lineWidth(0.6)
      .strokeColor(modern ? EGG : LINE)
      .stroke();
    doc
      .font("body")
      .fontSize(7)
      .fillColor(modern ? EGG : MUTED)
      .text("Photo", px, y + photoH / 2 - 4, { width: photoW, align: "center" });
  }
  y = Math.max(y + photoH, modern ? headH + 36 : y + headH) + 10;

  if (!b.released) {
    doc
      .font("bold")
      .fontSize(9)
      .fillColor(OVERDUE)
      .text("DRAFT: NOT RELEASED. Not valid as a report card.", L, y, {
        width: W,
        align: "center",
      });
    y = doc.y + 6;
  }

  // ---- Student details ----
  const details: [string, string][] = [
    ["Name", c.name],
    ["Admission no.", c.admissionNumber],
    ["Class", b.stream.name],
    ["UPI", c.upi ?? "–"],
    ["Boarding", c.boarder ? "Boarder" : "Day scholar"],
    ["Class teacher", b.stream.classTeacher ?? "–"],
  ];
  const colW = W / 3;
  details.forEach(([k, v], i) => {
    const x = L + (i % 3) * colW;
    const yy = y + Math.floor(i / 3) * 24;
    doc
      .font("body")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(k.toUpperCase(), x, yy, { width: colW - 6 });
    doc
      .font("bold")
      .fontSize(10)
      .fillColor(INK)
      .text(v, x, yy + 9, { width: colW - 6, lineBreak: false, ellipsis: true });
  });
  y += 52;

  // ---- Subjects ----
  const cols = [
    { h: "Learning area / subject", w: 0.32, a: "left" as const },
    { h: "Score %", w: 0.1, a: "right" as const },
    { h: b.scheme?.name.startsWith("KCSE") ? "Grade" : "Level", w: 0.09, a: "center" as const },
    { h: "Points", w: 0.08, a: "center" as const },
    { h: "Remarks", w: 0.33, a: "left" as const },
    { h: "Tr.", w: 0.08, a: "center" as const },
  ];
  const rowH = 17;
  const drawRow = (cells: string[], opts: { head?: boolean; bold?: boolean; shade?: boolean }) => {
    if (opts.head) doc.rect(L, y, W, rowH).fill(modern ? EGG : TEAL);
    else if (opts.shade) doc.rect(L, y, W, rowH).fill(modern ? CREAM : "#f4f6f5");
    let x = L;
    cells.forEach((text, i) => {
      const cw = cols[i].w * W;
      doc
        .font(opts.head || opts.bold ? "bold" : "body")
        .fontSize(opts.head ? 8 : 9)
        .fillColor(opts.head ? (modern ? INK : "#ffffff") : INK)
        .text(text, x + 4, y + (opts.head ? 5 : 4.5), {
          width: cw - 8,
          align: cols[i].a,
          lineBreak: false,
          ellipsis: true,
        });
      x += cw;
    });
    if (!modern) {
      doc
        .lineWidth(0.4)
        .strokeColor(LINE)
        .moveTo(L, y + rowH)
        .lineTo(R, y + rowH)
        .stroke();
    }
    y += rowH;
  };
  drawRow(
    cols.map((x) => x.h),
    { head: true },
  );
  c.subjects.forEach((s, i) =>
    drawRow(
      [s.name, s.score, s.code, s.points === null ? "" : String(s.points), s.comment, s.initials],
      {
        shade: modern && i % 2 === 1,
      },
    ),
  );
  if (!modern)
    doc
      .rect(L, y - rowH * (c.subjects.length + 1), W, rowH * (c.subjects.length + 1))
      .lineWidth(0.6)
      .strokeColor(TEAL)
      .stroke();
  y += 8;

  // ---- Totals and means ----
  const figures: [string, string][] = [
    ["Total", `${c.total} / ${c.outOf}`],
    ["Mean score", c.mean === "–" ? "–" : `${c.mean}%`],
    ["Mean points", c.meanPoints],
    [
      b.scheme?.name.startsWith("KCSE") ? "Mean grade" : "Overall level",
      `${c.meanGrade}${c.meanGradeLabel && c.meanGradeLabel !== c.meanGrade ? ` (${c.meanGradeLabel})` : ""}`,
    ],
  ];
  if (b.showPositions) {
    figures.push([
      "Stream position",
      c.streamPosition ? `${ordinal(c.streamPosition)} of ${b.streamSize}` : "–",
    ]);
    figures.push([
      "Class position",
      c.classPosition && b.classSize ? `${ordinal(c.classPosition)} of ${b.classSize}` : "–",
    ]);
  }
  const fw = W / figures.length;
  const boxH = 34;
  if (modern) doc.roundedRect(L, y, W, boxH, 6).fill(CREAM);
  else doc.rect(L, y, W, boxH).lineWidth(0.6).strokeColor(LINE).stroke();
  figures.forEach(([k, v], i) => {
    const x = L + i * fw;
    doc
      .font("body")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(k.toUpperCase(), x + 6, y + 5, { width: fw - 12 });
    doc
      .font("heading")
      .fontSize(11)
      .fillColor(TEAL)
      .text(v, x + 6, y + 16, { width: fw - 12, lineBreak: false, ellipsis: true });
  });
  y += boxH + 10;

  // ---- Competencies and values ----
  const comps = c.competencies.filter((x) => x.kind === "competency");
  const vals = c.competencies.filter((x) => x.kind === "value");
  if (comps.length || vals.length) {
    const half = (W - 12) / 2;
    const list = (title: string, items: typeof comps, x: number) => {
      let yy = y;
      doc.font("bold").fontSize(9).fillColor(TEAL).text(title, x, yy, { width: half });
      yy += 13;
      for (const it of items) {
        doc
          .font("body")
          .fontSize(8.5)
          .fillColor(INK)
          .text(it.name, x, yy, { width: half - 40, lineBreak: false, ellipsis: true });
        doc
          .font("bold")
          .fontSize(8.5)
          .fillColor(INK)
          .text(it.code || "–", x + half - 38, yy, { width: 38, align: "right" });
        yy += 11.5;
      }
      return yy;
    };
    const y1 = list("Core competencies", comps, L);
    const y2 = list("Values", vals, L + half + 12);
    y = Math.max(y1, y2) + 8;
  }

  // ---- Attendance, fees, next term ----
  const facts: string[] = [];
  if (c.attendance) {
    const a = c.attendance;
    const total = a.present + a.absent;
    facts.push(
      total
        ? `Attendance this term: present at ${a.present} of ${total} registers${a.late ? ` (${a.late} late)` : ""}${a.onLeave ? `, on leave-out ${a.onLeave}` : ""}.`
        : "Attendance this term: no registers recorded.",
    );
  }
  if (c.feeBalanceCents !== null)
    facts.push(
      c.feeBalanceCents > 0
        ? `Fee balance: ${kes(c.feeBalanceCents)} to pay.`
        : c.feeBalanceCents < 0
          ? `Fees: ${kes(c.feeBalanceCents)} paid ahead.`
          : "Fees: fully paid.",
    );
  if (b.nextTermStart) facts.push(`Next term opens on ${day(b.nextTermStart)}.`);
  if (facts.length) {
    doc.font("body").fontSize(9).fillColor(INK).text(facts.join("  "), L, y, { width: W });
    y = doc.y + 8;
  }

  // ---- Comments ----
  const comment = (title: string, text: string) => {
    doc.font("bold").fontSize(9).fillColor(TEAL).text(title, L, y, { width: W });
    doc
      .font("body")
      .fontSize(9.5)
      .fillColor(INK)
      .text(text || " ", L, doc.y + 2, { width: W, height: 40, ellipsis: true });
    y = Math.max(doc.y, y + 26) + 6;
  };
  comment("Class teacher's comment", c.classTeacherComment);
  comment("Principal's comment", c.principalComment);

  // ---- Signatures, stamp and verification ----
  const foot = doc.page.height - 36 - 96;
  y = Math.max(y + 4, foot);
  const sigW = (W - 110 - 24) / 2;
  for (const [i, who] of ["Class teacher", "Principal"].entries()) {
    const x = L + i * (sigW + 12);
    doc
      .lineWidth(0.6)
      .strokeColor(INK)
      .moveTo(x, y + 30)
      .lineTo(x + sigW, y + 30)
      .stroke();
    doc
      .font("body")
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${who}: signature and date`, x, y + 34, { width: sigW });
  }
  const stampX = L + 2 * (sigW + 12);
  doc
    .rect(stampX, y - 6, 100, 60)
    .dash(3, { space: 2 })
    .lineWidth(0.6)
    .strokeColor(LINE)
    .stroke()
    .undash();
  doc
    .font("body")
    .fontSize(7.5)
    .fillColor(MUTED)
    .text("School stamp", stampX, y + 20, { width: 100, align: "center" });

  // QR and footer line
  const fy = doc.page.height - 36 - 30;
  if (qr && c.token) {
    doc.image(qr, R - 52, fy - 30, { width: 52 });
    doc
      .font("body")
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `Check this report card is genuine: ${verifyUrl(c.token).replace(/^https?:\/\//, "")}`,
        L,
        fy + 8,
        {
          width: W - 60,
        },
      );
    if (b.releasedAt) doc.text(`Released ${day(b.releasedAt)}.`, L, doc.y + 1, { width: W - 60 });
  }
  doc
    .font("body")
    .fontSize(7)
    .fillColor(MUTED)
    .text("Powered by", L, fy - 6, { width: 44 });
  doc.image(logo(), L + 40, fy - 10, { width: 52 });
}
