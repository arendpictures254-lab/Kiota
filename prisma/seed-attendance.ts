/**
 * Attendance seed for Bahari Academy (runs as the owner, so it writes directly; idempotent: the
 * school's attendance is cleared and made again). Relative to today:
 *  - two weeks of registers (morning and afternoon) with realistic absences and lates: a few
 *    students absent often, more lates on Mondays, students out on leave marked On leave;
 *  - today's morning registers: Grade 7 East (Grace Wanjiru's) not yet submitted; in Grade 8
 *    East a boarder marked absent, waiting for the boarding master to check;
 *  - staff check-ins for the same days;
 *  - class teachers for two more streams, and generated placeholder photos for most students.
 */
import sharp from "sharp";
import type { PrismaClient } from "../src/generated/prisma/client";
import { atMinute, isSchoolDay, nairobiDate } from "../src/lib/attendance/rules";
import { getStorage, schoolKey } from "../src/lib/storage";
import { makePortrait } from "../src/lib/students/photos";

/** A small seeded random generator (the same data every run). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = ["#A9DCD6", "#C9A27A", "#E8D9C4", "#BFD8E8", "#D9C8E0", "#CFE3C2"];
const SKIN = ["#6B4226", "#7C4E2E", "#8D5A35", "#5A3620", "#9A6A45"];

/** A plain placeholder portrait: a soft background, head and shoulders, and initials. */
async function portrait(initials: string, i: number) {
  const bg = PALETTE[i % PALETTE.length];
  const skin = SKIN[i % SKIN.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1200" viewBox="0 0 960 1200">
    <rect width="960" height="1200" fill="${bg}"/>
    <ellipse cx="480" cy="1180" rx="380" ry="300" fill="#1F5F63"/>
    <rect x="410" y="700" width="140" height="160" rx="40" fill="${skin}"/>
    <ellipse cx="480" cy="520" rx="190" ry="230" fill="${skin}"/>
    <path d="M290 470 Q300 260 480 250 Q660 260 670 470 Q640 360 480 350 Q320 360 290 470Z" fill="#1E2422"/>
    <text x="480" y="1110" font-family="Arial, sans-serif" font-size="110" font-weight="700" fill="#FBF7F0" text-anchor="middle">${initials}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

export async function seedAttendance(owner: PrismaClient, schoolId: string) {
  const now = new Date();
  const today = nairobiDate(now);
  const rand = rng(2027);

  await owner.school.update({
    where: { id: schoolId },
    data: { modules: { set: ["boarding", "attendance"] } },
  });
  await owner.schoolSettings.update({
    where: { schoolId },
    data: {
      cardPhone: "0712 345 678",
      cardEmail: "office@bahari-academy.ac.ke",
      cardAddress: "P.O. Box 120-80108, Kilifi",
    },
  });

  // Class teachers for two more streams (Grade 8 West has none: the Principal takes it).
  const memberByPhone = async (phone: string) =>
    owner.membership.findFirstOrThrow({ where: { schoolId, user: { phone } } });
  const streams = await owner.stream.findMany({
    where: { schoolId },
    include: { class: true },
    orderBy: [{ class: { position: "asc" } }, { name: "asc" }],
  });
  const byLabel = (l: string) => streams.find((s) => `${s.class.name} ${s.name}` === l)!;
  await owner.stream.update({
    where: { id: byLabel("Grade 7 West").id },
    data: { classTeacherMembershipId: (await memberByPhone("+254711000009")).id },
  });
  await owner.stream.update({
    where: { id: byLabel("Grade 8 East").id },
    data: { classTeacherMembershipId: (await memberByPhone("+254711000010")).id },
  });

  // Start again (the owner may delete; the app role may not).
  await owner.absenceAlert.deleteMany({ where: { schoolId } });
  await owner.attendanceMark.deleteMany({ where: { schoolId } });
  await owner.attendanceRegister.deleteMany({ where: { schoolId } });
  await owner.staffAttendance.deleteMany({ where: { schoolId } });

  const sessions = await owner.attendanceSession.findMany({
    where: { schoolId, active: true },
    orderBy: { position: "asc" },
  });
  const students = await owner.student.findMany({
    where: { schoolId, status: "active" },
    orderBy: { admissionNumber: "asc" },
  });
  const leaveouts = await owner.leaveout.findMany({
    where: { schoolId, status: { in: ["out", "returned", "approved"] } },
  });
  const principal = await memberByPhone("+254711000006");
  const takerFor = async (streamId: string) => {
    const s = streams.find((x) => x.id === streamId)!;
    if (!s.classTeacherMembershipId) return principal.userId;
    const m = await owner.membership.findUniqueOrThrow({
      where: { id: s.classTeacherMembershipId },
    });
    return m.userId;
  };
  // A few students absent often; Mondays bring more lates.
  const often = new Set(students.filter((_, i) => i % 19 === 7).map((s) => s.id));

  // The last ten school days, then today.
  const days: Date[] = [];
  for (
    let d = new Date(today.getTime() - 86_400_000);
    days.length < 10;
    d = new Date(d.getTime() - 86_400_000)
  )
    if (isSchoolDay(d)) days.unshift(d);

  const onLeave = (studentId: string, from: Date, to: Date) =>
    leaveouts.find((l) => {
      if (l.studentId !== studentId) return false;
      const out = l.exitedAt ?? (l.status === "approved" ? null : l.leaveAt);
      if (!out) return false;
      const back = l.returnedAt ?? l.returnAt;
      return out <= to && back >= from;
    });

  async function register(
    day: Date,
    sessionId: string,
    streamId: string,
    opts: { absentBoarder?: boolean } = {},
  ) {
    const se = sessions.find((s) => s.id === sessionId)!;
    const from = atMinute(day, se.opensMinute);
    const to = atMinute(day, se.cutoffMinute);
    const takenAt = new Date(from.getTime() + (8 + Math.floor(rand() * 25)) * 60_000);
    const by = await takerFor(streamId);
    const reg = await owner.attendanceRegister.create({
      data: { schoolId, streamId, sessionId, date: day, submittedAt: takenAt, submittedById: by },
    });
    const monday = day.getUTCDay() === 1;
    const list = students.filter((s) => s.streamId === streamId);
    let pickedBoarder = false;
    const marks = list.map((s) => {
      const leave = onLeave(s.id, from, to);
      let status = "present";
      if (leave) status = "on_leave";
      else if (opts.absentBoarder && s.boarder && !pickedBoarder) {
        status = "absent";
        pickedBoarder = true;
      } else {
        const r = rand();
        const absentP = often.has(s.id) ? 0.22 : 0.03;
        const lateP = se.position === 1 ? (monday ? 0.14 : 0.05) : 0.02;
        status = r < absentP ? "absent" : r < absentP + lateP ? "late" : "present";
      }
      return {
        schoolId,
        registerId: reg.id,
        studentId: s.id,
        date: day,
        status,
        leaveoutId: leave?.id ?? null,
        markedById: by,
        createdAt: takenAt,
      };
    });
    await owner.attendanceMark.createMany({ data: marks });
    return { reg, marks };
  }

  for (const day of days)
    for (const se of sessions)
      for (const st of streams.filter((s) => s.schoolId === schoolId))
        await register(day, se.id, st.id);

  // Today's morning: every stream but Grade 7 East (Grace's, still to take).
  const morning = sessions[0];
  for (const st of streams) {
    if (`${st.class.name} ${st.name}` === "Grade 7 East") continue;
    const { marks, reg } = await register(today, morning.id, st.id, {
      absentBoarder: `${st.class.name} ${st.name}` === "Grade 8 East",
    });
    if (`${st.class.name} ${st.name}` !== "Grade 8 East") continue;
    // The absent boarder: waiting for the boarding master and matron.
    const absent = marks.find(
      (m) => m.status === "absent" && students.find((s) => s.id === m.studentId)?.boarder,
    );
    if (!absent) continue;
    const mark = await owner.attendanceMark.findFirstOrThrow({
      where: { registerId: absent.registerId, studentId: absent.studentId },
    });
    await owner.absenceAlert.create({
      data: {
        schoolId,
        markId: mark.id,
        studentId: absent.studentId,
        date: today,
        kind: "boarder",
        status: "waiting",
        createdAt: reg.submittedAt,
      },
    });
    const s = students.find((x) => x.id === absent.studentId)!;
    const alerted = await owner.membership.findMany({
      where: {
        schoolId,
        user: { phone: { in: ["+254711000005", "+254711000007", "+254711000001"] } },
      },
    });
    await owner.notification.deleteMany({
      where: { schoolId, title: "Boarder absent from class" },
    });
    await owner.notification.createMany({
      data: alerted.map((m) => ({
        schoolId,
        membershipId: m.id,
        title: "Boarder absent from class",
        body: `Grade 8 East, Morning: ${s.firstName} ${s.lastName}. Check the dormitory and say whether they were found.`,
        link: "/dashboard/attendance/boarders",
      })),
    });
  }

  // Later in the day: this afternoon's registers too (again all but Grade 7 East).
  const afternoon = sessions[1];
  const nowMinute = Math.floor(((now.getTime() + 3 * 3600_000) % 86_400_000) / 60_000);
  if (afternoon && nowMinute >= afternoon.cutoffMinute)
    for (const st of streams)
      if (`${st.class.name} ${st.name}` !== "Grade 7 East")
        await register(today, afternoon.id, st.id);

  // Staff: in between 07:10 and 07:55, out after 16:30; now and then absent or on leave.
  const staff = await owner.membership.findMany({
    where: {
      schoolId,
      status: "active",
      roles: { none: { role: { key: { in: ["system_payments", "system_messaging"] } } } },
    },
  });
  const staffRows = [];
  for (const [i, m] of staff.entries()) {
    for (const day of [...days, today]) {
      const isToday = day.getTime() === today.getTime();
      const r = rand();
      if (isToday && i % 3 === 2) continue; // not in yet
      const status = r < 0.03 ? "absent" : r < 0.06 ? "leave" : "present";
      const inAt = status === "present" ? atMinute(day, 430 + Math.floor(rand() * 45)) : null;
      const outAt =
        status === "present" && !isToday ? atMinute(day, 990 + Math.floor(rand() * 60)) : null;
      staffRows.push({
        schoolId,
        membershipId: m.id,
        date: day,
        status,
        inAt,
        outAt,
        source: status === "present" ? "self" : "manual",
        markedById: status === "present" ? m.userId : principal.userId,
        note: status === "leave" ? "Leave" : null,
      });
    }
  }
  await owner.staffAttendance.createMany({ data: staffRows });

  // Photos for most students (every ninth student still has none, to show what is missing).
  const storage = getStorage();
  for (const [i, s] of students.entries()) {
    if (s.photoKey || i % 9 === 4) continue;
    const original = await portrait(`${s.firstName[0]}${s.lastName[0]}`, i);
    const originalKey = schoolKey(schoolId, "students", s.id, "photo-original-seed");
    const key = schoolKey(schoolId, "students", s.id, "photo-seed");
    await storage.put(originalKey, original, "image/jpeg");
    await storage.put(key, await makePortrait(original), "image/jpeg");
    await owner.student.update({
      where: { id: s.id },
      data: { photoKey: key, photoOriginalKey: originalKey },
    });
  }
}
