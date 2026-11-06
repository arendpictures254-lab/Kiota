import ExcelJS from "exceljs";
import { actorFor, deps } from "@/lib/actions";
import { isoDay, parseDay } from "@/lib/attendance/rules";
import { attendanceReport } from "@/lib/attendance/service";
import { getSchoolContext } from "@/lib/auth/context";

/** Attendance for a period in one Excel workbook: per stream and per student (attendance.manage). */
export async function GET(req: Request) {
  const ctx = await getSchoolContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  if (!ctx.permissions.has("attendance.manage"))
    return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const r = await attendanceReport(deps, await actorFor(ctx), {
    from: parseDay(url.searchParams.get("from")),
    to: parseDay(url.searchParams.get("to")),
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kiota";
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const streams = wb.addWorksheet("By stream");
  streams.columns = [
    { header: "Stream", key: "label", width: 22 },
    { header: "Attendance %", key: "percent", width: 14 },
    { header: "Absences", key: "absent", width: 12 },
    { header: "Lates", key: "late", width: 10 },
  ];
  streams.addRows(r.streams);
  head(streams);
  const students = wb.addWorksheet("By student");
  students.columns = [
    { header: "Admission no.", key: "admissionNumber", width: 16 },
    { header: "Name", key: "name", width: 26 },
    { header: "Class", key: "className", width: 16 },
    { header: "Boarder", key: "boarder", width: 10 },
    { header: "Attendance %", key: "percent", width: 14 },
    { header: "Days absent", key: "daysAbsent", width: 12 },
    { header: "Part days absent", key: "partDays", width: 16 },
    { header: "Lates", key: "lates", width: 10 },
  ];
  students.addRows(
    [...r.perStudent]
      .sort((a, b) => a.admissionNumber.localeCompare(b.admissionNumber))
      .map((s) => ({ ...s, boarder: s.boarder ? "Yes" : "No" })),
  );
  head(students);
  const bytes = await wb.xlsx.writeBuffer();
  const name = `kiota-attendance-${ctx.school.shortName.toLowerCase()}-${isoDay(r.period.from)}-to-${isoDay(r.period.to)}.xlsx`;
  return new Response(new Uint8Array(bytes as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
