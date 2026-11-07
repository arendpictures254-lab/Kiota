import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, withContext } from "@/lib/db-core";
import { gateCard, reissueCard, cardsForPrint } from "@/lib/idcards/service";
import { parseCard, verifyCard } from "@/lib/idcards/card-token";
import { gateBundle } from "@/lib/leaveout/gate";
import { adminCreditWallet } from "@/lib/messaging/wallet";
import type { Actor } from "@/lib/service-kit";
import { childAttendance, childCurrentTerm } from "@/lib/portal/service";
import { updateAbsenceSettings, updateSchoolWeek } from "@/lib/settings/service";
import { saveStudentPhoto } from "@/lib/students/photos";
import sharp from "sharp";
import {
  app,
  appUnguarded,
  makeAdmin,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import { nairobiDate } from "./rules";
import {
  attendanceToday,
  boarderAlerts,
  loadRegister,
  myRegisters,
  processAbsenceAlerts,
  resolveBoarderAlert,
  studentAttendance,
  submitRegister,
} from "./service";
import { markStaff, staffDaily, tapStaffAttendance } from "./staff";

const deps = { db: app };

function actorFor(schoolId: string, userId: string, role: string): Actor {
  return {
    userId,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions as PermissionKey[],
      grants: [],
    }),
  };
}

// A school day morning (Wednesday 11 Nov 2026, 07:45 Nairobi), and times after it.
const MORNING = new Date("2026-11-11T07:45:00+03:00");
const at = (minutesLater: number) => new Date(MORNING.getTime() + minutesLater * 60_000);
const TODAY = nairobiDate(MORNING);

async function makeFixture(label: string) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  await owner.school.update({ where: { id: school.id }, data: { modules: ["boarding"] } });
  const east = await makeStream(school.id, "Grade 7", "East");
  const member = async (role: string) => {
    const m = await makeMember(school.id, [role], role);
    return { ...m, actor: actorFor(school.id, m.user.id, role) };
  };
  const director = await member("director");
  const principal = await member("principal");
  const teacher = await member("class_teacher");
  const otherTeacher = await member("class_teacher");
  const boardingMaster = await member("boarding_master");
  const matron = await member("matron");
  const guard = await member("gate_guard");
  const secretary = await member("secretary");
  await owner.stream.update({
    where: { id: east.id },
    data: { classTeacherMembershipId: teacher.membership.id },
  });
  const admin = await makeAdmin();
  await adminCreditWallet({ db: app }, { userId: admin.id, isPlatformAdmin: true }, school.id, {
    kind: "starter",
    amount: "500",
  });
  const morning = await owner.attendanceSession.findFirstOrThrow({
    where: { schoolId: school.id, name: "Morning" },
  });
  return {
    school,
    east,
    morning,
    director,
    principal,
    teacher,
    otherTeacher,
    boardingMaster,
    matron,
    guard,
    secretary,
  };
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function student(f: Fixture, name: string, boarder = false) {
  const s = await makeStudent(f.school.id, f.east.id, { firstName: name, lastName: "Otieno" });
  await owner.student.update({ where: { id: s.id }, data: { boarder } });
  const phone = randomPhone();
  const user = await owner.user.create({ data: { phone, name: "Parent" } });
  await owner.guardianLink.create({
    data: {
      schoolId: f.school.id,
      studentId: s.id,
      userId: user.id,
      name: `Parent of ${name}`,
      relationship: "mother",
    },
  });
  return { ...s, boarder, parentPhone: phone };
}

const key = (f: Fixture) => ({ streamId: f.east.id, sessionId: f.morning.id, date: TODAY });
const smsTo = (schoolId: string, templateKey: string, phone?: string) =>
  owner.message.findMany({
    where: { schoolId, templateKey, ...(phone ? { toPhone: phone } : {}) },
  });

let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeFixture("Attend A");
  B = await makeFixture("Attend B");
});

afterAll(async () => {
  await app.$disconnect();
  await appUnguarded.$disconnect();
  await owner.$disconnect();
});

describe("the register", () => {
  let f: Fixture;
  let kids: Awaited<ReturnType<typeof student>>[];
  beforeAll(async () => {
    f = await makeFixture("Register");
    kids = [
      await student(f, "Amani"),
      await student(f, "Baraka"),
      await student(f, "Chiku"),
      await student(f, "Dalia", true),
    ];
  });

  it("starts with everyone present and is taken in one submit by the class teacher", async () => {
    const list = await myRegisters(deps, f.teacher.actor, MORNING);
    expect(list.streams.map((s) => s.label)).toEqual(["Grade 7 East"]);
    const before = await loadRegister(deps, f.teacher.actor, key(f), MORNING);
    expect(before.submitted).toBeNull();
    expect(before.rows.every((r) => r.status === "present")).toBe(true);

    const r = await submitRegister(
      deps,
      f.teacher.actor,
      { ...key(f), absent: [kids[0].id], late: [kids[1].id] },
      MORNING,
    );
    expect(r.counts).toEqual({ present: 2, absent: 1, late: 1, on_leave: 0 });
    const after = await loadRegister(deps, f.teacher.actor, key(f), MORNING);
    expect(after.submitted).toMatchObject({ by: "class_teacher" });
    expect(Object.fromEntries(after.rows.map((x) => [x.name.split(" ")[0], x.status]))).toEqual({
      Amani: "absent",
      Baraka: "late",
      Chiku: "present",
      Dalia: "present",
    });
    const log = await owner.auditLog.findFirst({
      where: { schoolId: f.school.id, action: "attendance.submit", targetId: r.registerId },
    });
    expect(log?.after).toMatchObject({ absent: 1, late: 1, present: 2 });
  });

  it("is only for the class teacher's own stream (or the Principal)", async () => {
    await expect(loadRegister(deps, f.otherTeacher.actor, key(f), MORNING)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      submitRegister(deps, f.otherTeacher.actor, { ...key(f), absent: [], late: [] }, MORNING),
    ).rejects.toThrow(ForbiddenError);
    expect((await myRegisters(deps, f.otherTeacher.actor, MORNING)).streams).toEqual([]);
    expect((await myRegisters(deps, f.principal.actor, MORNING)).streams).toHaveLength(1);
  });

  it("corrections: the same day by the teacher (audited); later only by the Principal", async () => {
    const r = await submitRegister(
      deps,
      f.teacher.actor,
      { ...key(f), absent: [], late: [kids[1].id] }, // Amani was there after all
      at(10),
    );
    expect(r).toMatchObject({ corrected: true, changed: 1 });
    const log = await owner.auditLog.findFirst({
      where: { schoolId: f.school.id, action: "attendance.correct", targetId: r.registerId },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.before).toEqual({ changes: [{ studentId: kids[0].id, status: "absent" }] });
    expect(log?.after).toEqual({ changes: [{ studentId: kids[0].id, status: "present" }] });

    const tomorrow = new Date(MORNING.getTime() + 86_400_000);
    await expect(
      submitRegister(
        deps,
        f.teacher.actor,
        { ...key(f), absent: [kids[2].id], late: [] },
        tomorrow,
      ),
    ).rejects.toThrow(/ask the Principal/);
    const p = await submitRegister(
      deps,
      f.principal.actor,
      { ...key(f), absent: [kids[2].id], late: [kids[1].id] },
      tomorrow,
    );
    expect(p).toMatchObject({ corrected: true, changed: 1 });
  });
});

describe("students on leave", () => {
  it("are shown On leave and can't be marked absent", async () => {
    const f = await makeFixture("On leave");
    const away = await student(f, "Eli", true);
    const here = await student(f, "Faraji", true);
    await owner.leaveout.create({
      data: {
        schoolId: f.school.id,
        studentId: away.id,
        reason: "Medical appointment",
        leaveAt: new Date(MORNING.getTime() - 86_400_000),
        returnAt: new Date(MORNING.getTime() + 86_400_000),
        collectorKind: "guardian",
        collectorName: "Parent",
        collectorPhone: away.parentPhone,
        collectorRelationship: "mother",
        status: "out",
        exitedAt: new Date(MORNING.getTime() - 86_400_000),
        requestedVia: "staff",
        requestedById: f.director.user.id,
        studentName: "Eli Otieno",
        admissionNumber: away.admissionNumber,
        classLabel: "Grade 7 East",
      },
    });
    const reg = await loadRegister(deps, f.teacher.actor, key(f), MORNING);
    expect(reg.rows.find((r) => r.studentId === away.id)).toMatchObject({
      status: "on_leave",
      locked: true,
    });
    // Sent as absent anyway: stays On leave, and nobody is alerted.
    const r = await submitRegister(
      deps,
      f.teacher.actor,
      { ...key(f), absent: [away.id], late: [] },
      MORNING,
    );
    expect(r.counts).toMatchObject({ on_leave: 1, absent: 0, present: 1 });
    expect(await owner.absenceAlert.count({ where: { schoolId: f.school.id } })).toBe(0);
    expect(here).toBeTruthy();
  });
});

describe("who gets told about an absence", () => {
  it("a day scholar's parents get an SMS after the delay; a quick correction cancels it", async () => {
    const f = await makeFixture("Day SMS");
    const g = await student(f, "Gift");
    const h = await student(f, "Hawa");
    await submitRegister(
      deps,
      f.teacher.actor,
      { ...key(f), absent: [g.id, h.id], late: [] },
      MORNING,
    );
    const alerts = await owner.absenceAlert.findMany({ where: { schoolId: f.school.id } });
    expect(alerts.map((a) => a.kind)).toEqual(["parent_sms", "parent_sms"]);
    expect(alerts[0].dueAt!.getTime()).toBe(at(30).getTime()); // the default 30 minutes

    // Before the delay: nothing goes.
    await processAbsenceAlerts(app, at(29));
    expect(await smsTo(f.school.id, "attendance_absent")).toHaveLength(0);
    // Hawa was in the toilet: corrected within the delay, so her parents never hear of it.
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [g.id], late: [] }, at(5));
    await processAbsenceAlerts(app, at(31));
    const sent = await smsTo(f.school.id, "attendance_absent");
    expect(sent.map((m) => m.toPhone)).toEqual([g.parentPhone]);
    expect(sent[0].body).toContain("Gift was marked absent from the morning register");
    expect(sent[0].critical).toBe(false);
    expect(
      (
        await owner.absenceAlert.findMany({
          where: { schoolId: f.school.id },
          orderBy: { status: "asc" },
        })
      ).map((a) => a.status),
    ).toEqual(["cancelled", "sent"]);
    // Run again: sent once only.
    await processAbsenceAlerts(app, at(60));
    expect(await smsTo(f.school.id, "attendance_absent")).toHaveLength(1);
  });

  it("the school can switch day-scholar SMS off, and set the delay", async () => {
    const f = await makeFixture("Day off");
    const s = await student(f, "Imani");
    await updateAbsenceSettings(deps, f.principal.actor, { delayMinutes: "0" });
    await expect(
      updateAbsenceSettings(deps, f.teacher.actor, { daySms: "on", delayMinutes: "5" }),
    ).rejects.toThrow(ForbiddenError);
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [s.id], late: [] }, MORNING);
    expect(await owner.absenceAlert.count({ where: { schoolId: f.school.id } })).toBe(0);
  });

  it("an absent boarder alerts the boarding staff in the app, not the parents", async () => {
    const f = await makeFixture("Boarder");
    const b = await student(f, "Jabali", true);
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [b.id], late: [] }, MORNING);
    const alerts = await owner.absenceAlert.findMany({ where: { schoolId: f.school.id } });
    expect(alerts.map((a) => a.kind)).toEqual(["boarder"]);
    const notified = await owner.notification.findMany({
      where: { schoolId: f.school.id, title: "Boarder absent from class" },
      select: { membershipId: true, body: true },
    });
    expect(notified.map((n) => n.membershipId).sort()).toEqual(
      [f.director.membership.id, f.boardingMaster.membership.id, f.matron.membership.id].sort(),
    );
    expect(notified[0].body).toContain("Jabali Otieno");
    await processAbsenceAlerts(app, at(120));
    expect(
      await owner.message.count({ where: { schoolId: f.school.id, toPhone: b.parentPhone } }),
    ).toBe(0);

    // The matron finds him in the sick bay: still no SMS.
    const list = await boarderAlerts(deps, f.matron.actor, MORNING);
    expect(list.map((x) => x.student.firstName)).toEqual(["Jabali"]);
    await expect(
      resolveBoarderAlert(deps, f.teacher.actor, list[0].id, true, null, at(20)),
    ).rejects.toThrow(ForbiddenError);
    await resolveBoarderAlert(deps, f.matron.actor, list[0].id, true, "In the sick bay", at(20));
    expect(
      await owner.message.count({ where: { schoolId: f.school.id, toPhone: b.parentPhone } }),
    ).toBe(0);
  });

  it("a boarder not found sends the parents a critical SMS", async () => {
    const f = await makeFixture("Not found");
    const b = await student(f, "Kito", true);
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [b.id], late: [] }, MORNING);
    const [alert] = await boarderAlerts(deps, f.boardingMaster.actor, MORNING);
    await resolveBoarderAlert(
      deps,
      f.boardingMaster.actor,
      alert.id,
      false,
      "Not in the dorm",
      at(25),
    );
    const [sms] = await smsTo(f.school.id, "attendance_not_found", b.parentPhone);
    expect(sms.critical).toBe(true);
    expect(sms.body).toContain("URGENT. Kito was absent from class today");
    await expect(
      resolveBoarderAlert(deps, f.boardingMaster.actor, alert.id, true, null, at(30)),
    ).rejects.toThrow(/already answered/);
    expect(
      await owner.notification.count({
        where: {
          schoolId: f.school.id,
          title: "Boarder not found",
          membershipId: f.principal.membership.id,
        },
      }),
    ).toBe(1);
  });

  it("with direct parent alerts on, a boarder's parents get the SMS after the delay too", async () => {
    const f = await makeFixture("Boarder direct");
    const b = await student(f, "Lulu", true);
    await updateAbsenceSettings(deps, f.director.actor, {
      daySms: "on",
      delayMinutes: "15",
      boarderSms: "on",
    });
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [b.id], late: [] }, MORNING);
    await processAbsenceAlerts(app, at(16));
    const [sms] = await smsTo(f.school.id, "attendance_boarder_absent", b.parentPhone);
    expect(sms.body).toContain("The boarding staff are checking");
  });
});

describe("dashboards and the profile", () => {
  it("show today at a glance, late registers, and a student's term", async () => {
    const f = await makeFixture("Glance");
    const west = await makeStream(f.school.id, "Grade 7", "West");
    const m = await student(f, "Mosi");
    await makeStudent(f.school.id, west.id, { firstName: "Nuru" });
    await submitRegister(deps, f.teacher.actor, { ...key(f), absent: [m.id], late: [] }, MORNING);
    const t = await attendanceToday(deps, f.principal.actor, at(60)); // 08:45, after the cut-off
    expect(t.session?.name).toBe("Morning");
    expect(t.totals).toMatchObject({ absent: 1, present: 0 });
    expect(t.overdue.map((o) => o.stream)).toEqual(["Grade 7 West"]);
    await expect(attendanceToday(deps, f.teacher.actor, at(60))).rejects.toThrow(ForbiddenError);
    const s = await studentAttendance(deps, f.teacher.actor, m.id, at(60));
    expect(s).toMatchObject({ percent: 0, daysAbsent: 1, lates: 0 });
    expect(s.days).toEqual([{ date: "2026-11-11", status: "absent" }]);
  });
});

describe("staff attendance", () => {
  it("staff tap in and out for themselves only; the Principal marks anyone", async () => {
    const f = await makeFixture("Staff");
    const inAt = await tapStaffAttendance(deps, f.teacher.actor, "in", MORNING);
    expect(inAt).toMatchObject({ status: "present", source: "self" });
    const out = await tapStaffAttendance(deps, f.teacher.actor, "out", at(9 * 60));
    expect(out.outAt?.getTime()).toBe(at(9 * 60).getTime());
    // A teacher cannot mark a colleague, in the app...
    await expect(
      markStaff(
        deps,
        f.teacher.actor,
        { membershipId: f.matron.membership.id, status: "absent" },
        MORNING,
      ),
    ).rejects.toThrow(ForbiddenError);
    // ...or straight in the database.
    await expect(
      withContext(app, { userId: f.teacher.user.id, schoolId: f.school.id }, (tx) =>
        appUnguardedInsert(tx, f, f.matron.membership.id),
      ),
    ).rejects.toThrow(/row-level security/);
    await markStaff(
      deps,
      f.principal.actor,
      { membershipId: f.matron.membership.id, status: "leave", note: "Annual leave" },
      MORNING,
    );
    const day = await staffDaily(deps, f.principal.actor, null, MORNING);
    expect(day.staff.find((s) => s.membershipId === f.matron.membership.id)).toMatchObject({
      status: "leave",
      source: "manual",
    });
    expect(day.staff.find((s) => s.membershipId === f.teacher.membership.id)).toMatchObject({
      status: "present",
      source: "self",
    });
    await expect(staffDaily(deps, f.teacher.actor, null, MORNING)).rejects.toThrow(ForbiddenError);
  });
});

/** A raw insert for someone else's day (row-level security must refuse it). */
function appUnguardedInsert(
  tx: Parameters<Parameters<typeof withContext>[2]>[0],
  f: Fixture,
  membershipId: string,
) {
  return tx.$executeRaw`
    INSERT INTO staff_attendance (school_id, membership_id, date, status, source, marked_by_id)
    VALUES (${f.school.id}::uuid, ${membershipId}::uuid, ${TODAY}::date, 'present', 'self', ${f.teacher.user.id}::uuid)`;
}

describe("photos and ID cards", () => {
  const jpeg = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: "#7A5634" } })
      .jpeg()
      .toBuffer();

  it("crops every photo to one portrait size and keeps the original", async () => {
    const f = await makeFixture("Photo");
    const s = await student(f, "Pendo");
    const bytes = await jpeg(1200, 800);
    await saveStudentPhoto(deps, f.secretary.actor, s.id, {
      name: "x.jpg",
      type: "image/jpeg",
      bytes,
    });
    const row = await owner.student.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.photoKey).toBeTruthy();
    expect(row.photoOriginalKey).toBeTruthy();
    const { getStorage } = await import("@/lib/storage");
    const portrait = await getStorage().get(row.photoKey!);
    const meta = await sharp(portrait!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([480, 600]);
    expect((await getStorage().get(row.photoOriginalKey!))!.bytes.length).toBe(bytes.length);
    // The bulk upload checks the file is named for this student.
    await expect(
      saveStudentPhoto(
        deps,
        f.secretary.actor,
        s.id,
        { name: "XX-9999-001.jpg", type: "image/jpeg", bytes },
        { source: "bulk", checkFileName: true },
      ),
    ).rejects.toThrow(/not named for/);
    // A gate guard can't.
    await expect(
      saveStudentPhoto(deps, f.guard.actor, s.id, { name: "x.jpg", type: "image/jpeg", bytes }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("an ID card's QR shows who the student is and 'no valid leave-out'; a reissue stops the old card", async () => {
    const f = await makeFixture("Cards");
    const s = await student(f, "Rehema", true);
    await expect(cardsForPrint(deps, f.teacher.actor, { streamId: f.east.id })).rejects.toThrow(
      ForbiddenError,
    );
    const { cards } = await cardsForPrint(deps, f.secretary.actor, { streamId: f.east.id });
    const card = cards.find((c) => c.studentId === s.id)!;
    expect(card.token.startsWith("KC1.")).toBe(true);
    expect(card.token).not.toContain("Rehema");
    expect(parseCard(card.token)).toMatchObject({ schoolId: f.school.id, cardId: card.cardId });
    // Signed with the school's key (the gate can check it offline); not a gate pass.
    const bundle = await gateBundle(deps, f.guard.actor);
    expect(await verifyCard(card.token, bundle.publicKey!)).toBe("valid");

    const scan = await gateCard(deps, f.guard.actor, card.token);
    expect(scan).toMatchObject({
      found: true,
      live: true,
      pass: null, // "No valid leave-out"
      student: { name: "Rehema Otieno", classLabel: "Grade 7 East", boarder: true },
    });
    // Printing again keeps the same card.
    const again = await cardsForPrint(deps, f.secretary.actor, { studentIds: [s.id] });
    expect(again.cards[0].cardId).toBe(card.cardId);

    // Lost: reissued. The old QR finds a revoked card; the new one works.
    await reissueCard(deps, f.secretary.actor, s.id, "Lost on the bus");
    expect(await gateCard(deps, f.guard.actor, card.token)).toMatchObject({
      found: true,
      live: false,
    });
    const fresh = (await cardsForPrint(deps, f.secretary.actor, { studentIds: [s.id] })).cards[0];
    expect(fresh.cardId).not.toBe(card.cardId);
    expect(await gateCard(deps, f.guard.actor, fresh.token)).toMatchObject({
      found: true,
      live: true,
    });

    // Another school's guard learns nothing from it.
    expect(await gateCard(deps, B.guard.actor, fresh.token)).toEqual({
      found: false,
      reason: "other_school",
    });
  });
});

describe("school walls", () => {
  it("School B can never read School A's attendance", async () => {
    const s = await student(A, "Sefu");
    await submitRegister(deps, A.teacher.actor, { ...key(A), absent: [s.id], late: [] }, MORNING);
    await tapStaffAttendance(deps, A.teacher.actor, "in", MORNING);

    // Through the services: A's stream is not found for B.
    await expect(loadRegister(deps, B.director.actor, key(A), MORNING)).rejects.toThrow(
      /not found/,
    );
    expect((await attendanceToday(deps, B.director.actor, MORNING)).totals.absent).toBe(0);
    // Straight in the database, without the school filter: row-level security hides it all.
    const asB = scopedDb(appUnguarded, { userId: B.director.user.id, schoolId: B.school.id });
    expect(await asB.attendanceMark.count()).toBe(0);
    expect(await asB.attendanceRegister.count()).toBe(0);
    expect(await asB.absenceAlert.count()).toBe(0);
    expect(await asB.staffAttendance.count()).toBe(0);
    expect(await asB.studentCard.count()).toBe(0);
    // A director of B pretending to be at A sees nothing either.
    const sneaky = scopedDb(appUnguarded, { userId: B.director.user.id, schoolId: A.school.id });
    expect(await sneaky.attendanceMark.count()).toBe(0);
    expect(await sneaky.staffAttendance.count()).toBe(0);
  });
});

describe("the school week", () => {
  it("expects Saturday registers only from the levels with Saturday classes", async () => {
    const f = await makeFixture("Week");
    const g4 = await makeStream(f.school.id, "Grade 4", "North");
    await makeStudent(f.school.id, g4.id, { firstName: "Tatu" });
    await student(f, "Umi"); // Grade 7 East
    const saturday = new Date("2026-11-14T09:00:00+03:00"); // after the 08:30 cut-off
    // Default week (Monday to Friday): nothing is late on a Saturday.
    expect((await attendanceToday(deps, f.principal.actor, saturday)).overdue).toEqual([]);
    // Grade 7's level has Saturday classes; Grade 4's does not.
    const g7Level = await owner.class.findFirstOrThrow({
      where: { schoolId: f.school.id, name: "Grade 7" },
    });
    await updateSchoolWeek(deps, f.principal.actor, {
      days: ["1", "2", "3", "4", "5"],
      saturdayLevels: [g7Level.levelId],
    });
    const t = await attendanceToday(deps, f.principal.actor, saturday);
    expect(t.overdue.map((o) => `${o.stream} ${o.session}`)).toEqual(["Grade 7 East Morning"]);
    const mine = await myRegisters(deps, f.teacher.actor, saturday);
    expect(mine.streams[0].registers[0].overdue).toBe(true);
    // Only the Principal or Director sets it.
    await expect(
      updateSchoolWeek(deps, f.teacher.actor, { days: ["1"], saturdayLevels: [] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateSchoolWeek(deps, f.principal.actor, { days: [], saturdayLevels: [] }),
    ).rejects.toThrow(/at least one/);
  });
});

describe("the parent portal", () => {
  it("shows attendance for the current term, through the parent's own link", async () => {
    const f = await makeFixture("Portal term");
    await owner.school.update({
      where: { id: f.school.id },
      data: { modules: ["boarding", "attendance"] },
    });
    const s = await student(f, "Wema");
    const parent = await owner.guardianLink.findFirstOrThrow({
      where: { schoolId: f.school.id, studentId: s.id },
    });
    const today = nairobiDate(new Date());
    const year = await owner.academicYear.create({
      data: {
        schoolId: f.school.id,
        name: "2026",
        startDate: new Date(today.getTime() - 200 * 86_400_000),
        endDate: new Date(today.getTime() + 100 * 86_400_000),
      },
    });
    await owner.term.create({
      data: {
        schoolId: f.school.id,
        academicYearId: year.id,
        name: "Term 3",
        startDate: new Date(today.getTime() - 50 * 86_400_000),
        endDate: new Date(today.getTime() + 20 * 86_400_000),
      },
    });
    // Absent six weeks ago (inside the term, outside "the last four weeks"); present today.
    const sixWeeksAgo = new Date(Date.now() - 42 * 86_400_000);
    await submitRegister(
      deps,
      f.principal.actor,
      { ...key(f), date: nairobiDate(sixWeeksAgo), absent: [s.id], late: [] },
      sixWeeksAgo,
    );
    await submitRegister(deps, f.teacher.actor, { ...key(f), date: today, absent: [], late: [] });
    const a = (await childAttendance({ db: app }, parent.userId, parent.id))!;
    expect(a.term).toMatchObject({ name: "Term 3", year: "2026" });
    expect(a.period.label).toBe("Term 3 2026");
    expect(a).toMatchObject({ daysAbsent: 1, percent: 50 });
    // Someone else's link shows nothing.
    const stranger = await owner.user.create({ data: { phone: randomPhone(), name: "X" } });
    expect(await childCurrentTerm({ db: app }, stranger.id, parent.id)).toBeNull();
  });
});

describe("ID cards at the gate, offline", () => {
  it("the gate's bundle has each live card's student, and replaced cards with no name", async () => {
    const f = await makeFixture("Cards offline");
    const s = await student(f, "Zuri", true);
    const { cards } = await cardsForPrint(deps, f.secretary.actor, { studentIds: [s.id] });
    await reissueCard(deps, f.secretary.actor, s.id, "Lost");
    const bundle = await gateBundle(deps, f.guard.actor);
    const old = bundle.cards.find((c) => c.id === cards[0].cardId)!;
    expect(old).toMatchObject({ live: false, name: null, classLabel: null });
    const fresh = bundle.cards.find((c) => c.live && c.studentId === s.id)!;
    expect(fresh).toMatchObject({ name: "Zuri Otieno", classLabel: "Grade 7 East", boarder: true });
    // Another school's guard gets none of them.
    expect((await gateBundle(deps, B.guard.actor)).cards.some((c) => c.studentId === s.id)).toBe(
      false,
    );
  });
});
