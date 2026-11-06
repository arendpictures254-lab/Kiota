import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb } from "@/lib/db-core";
import { getStatement } from "@/lib/fees/receipts";
import { adminCreditWallet } from "@/lib/messaging/wallet";
import type { Actor } from "@/lib/service-kit";
import { getStudent, listStudents } from "@/lib/students/service";
import {
  app,
  makeAdmin,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import { gateBundle, gatePass, recordGateEvents, searchGatePasses } from "./gate";
import { parentLeaveouts, parentRequestLeaveout, smsCollectorReply } from "./parent";
import { parsePass, pickupCodeHash, verifyPass } from "./pass-token";
import { passVerdict } from "./rules";
import {
  approveLeaveout,
  cancelLeaveout,
  checkOverdueLeaveouts,
  declineLeaveout,
  getLeaveout,
  halfTermPasses,
  leaveoutLists,
  parseLeaveoutInput,
  requestLeaveout,
} from "./service";

const deps = { db: app };

function actorFor(
  schoolId: string,
  userId: string,
  role: string,
  grants: PermissionKey[] = [],
): Actor {
  return {
    userId,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
      grants,
    }),
  };
}

/** "2026-11-13T14:00" in Nairobi time, `hours` from now (for the form inputs). */
const nairobi = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3600_000 + 3 * 3600_000).toISOString().slice(0, 16);

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeFixture(label: string) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  await owner.school.update({ where: { id: school.id }, data: { modules: ["boarding"] } });
  const east = await makeStream(school.id, "Grade 7", "East");
  const member = async (role: string, grants: PermissionKey[] = []) => {
    const m = await makeMember(school.id, [role], role);
    for (const g of grants) {
      await owner.permissionGrant.create({
        data: {
          schoolId: school.id,
          membershipId: m.membership.id,
          permissionKey: g,
          grantedById: m.user.id,
        },
      });
    }
    return { ...m, actor: actorFor(school.id, m.user.id, role, grants) };
  };
  const director = await member("director");
  const approver = await member("boarding_master", ["leaveout.approve"]);
  const boardingMaster = await member("boarding_master");
  const teacher = await member("class_teacher");
  await owner.stream.update({
    where: { id: east.id },
    data: { classTeacherMembershipId: teacher.membership.id },
  });
  const guard = await member("gate_guard");
  const admin = await makeAdmin();
  await adminCreditWallet({ db: app }, { userId: admin.id, isPlatformAdmin: true }, school.id, {
    kind: "starter",
    amount: "500",
  });
  return { school, east, director, approver, boardingMaster, teacher, guard };
}

async function child(f: Fixture, opts: { language?: "en" | "sw"; name?: string } = {}) {
  const student = await makeStudent(f.school.id, f.east.id, {
    firstName: opts.name ?? "Amani",
    lastName: "Mwangi",
  });
  const mumPhone = randomPhone();
  const mum = await owner.user.create({ data: { phone: mumPhone, name: "Mum" } });
  const mother = await owner.guardianLink.create({
    data: {
      schoolId: f.school.id,
      studentId: student.id,
      userId: mum.id,
      name: "Mary Mwangi",
      relationship: "mother",
      language: opts.language ?? "en",
      authorisedToCollect: true,
    },
  });
  const dad = await owner.user.create({ data: { phone: randomPhone(), name: "Dad" } });
  const father = await owner.guardianLink.create({
    data: {
      schoolId: f.school.id,
      studentId: student.id,
      userId: dad.id,
      name: "John Mwangi",
      relationship: "father",
      authorisedToCollect: false,
    },
  });
  return { student, mother, father, mumPhone, mumId: mum.id };
}

async function reasonId(f: Fixture, name = "Weekend") {
  return (await owner.leaveoutReason.findFirstOrThrow({ where: { schoolId: f.school.id, name } }))
    .id;
}

async function approvedPass(
  f: Fixture,
  c: Awaited<ReturnType<typeof child>>,
  hours = { leave: 0.5, back: 48 },
) {
  const l = await requestLeaveout(
    deps,
    f.teacher.actor,
    parseLeaveoutInput({
      studentId: c.student.id,
      reasonId: await reasonId(f),
      leaveAt: nairobi(hours.leave),
      returnAt: nairobi(hours.back),
      collector: `link:${c.mother.id}`,
    }),
  );
  const { pickupCode } = await approveLeaveout(deps, f.approver.actor, l.id);
  const row = await owner.leaveout.findUniqueOrThrow({ where: { id: l.id } });
  return { id: l.id, token: row.passToken!, code: pickupCode };
}

const messagesTo = (schoolId: string, templateKey: string) =>
  owner.message.findMany({ where: { schoolId, templateKey }, orderBy: { createdAt: "asc" } });

let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeFixture("Leave A");
  B = await makeFixture("Leave B");
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("who may approve", () => {
  it("only staff the Director granted leaveout.approve (and the Director) can approve", async () => {
    const c = await child(A);
    const l = await requestLeaveout(
      deps,
      A.teacher.actor,
      parseLeaveoutInput({
        studentId: c.student.id,
        reasonId: await reasonId(A),
        leaveAt: nairobi(2),
        returnAt: nairobi(30),
        collector: `link:${c.mother.id}`,
      }),
    );
    expect(l.status).toBe("pending");
    await expect(approveLeaveout(deps, A.boardingMaster.actor, l.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(approveLeaveout(deps, A.teacher.actor, l.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(approveLeaveout(deps, A.guard.actor, l.id)).rejects.toBeInstanceOf(ForbiddenError);
    await approveLeaveout(deps, A.approver.actor, l.id);
    const detail = await getLeaveout(deps, A.director.actor, l.id);
    expect(detail).toMatchObject({ status: "approved", approvedBy: "boarding_master" });
    // Every step is in the audit log.
    const actions = await owner.auditLog.findMany({
      where: { schoolId: A.school.id, targetId: l.id },
    });
    expect(actions.map((a) => a.action).sort()).toEqual(["leaveout.approve", "leaveout.request"]);
  });

  it("a gate guard cannot request, and a decline needs a reason and tells the parent", async () => {
    const c = await child(A);
    const input = parseLeaveoutInput({
      studentId: c.student.id,
      reasonId: await reasonId(A),
      leaveAt: nairobi(2),
      returnAt: nairobi(30),
      collector: `link:${c.mother.id}`,
    });
    await expect(requestLeaveout(deps, A.guard.actor, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const l = await requestLeaveout(deps, A.boardingMaster.actor, input);
    await expect(declineLeaveout(deps, A.approver.actor, l.id, " ")).rejects.toThrow(/reason/);
    await declineLeaveout(deps, A.approver.actor, l.id, "Exams on Monday");
    const sms = (await messagesTo(A.school.id, "leaveout_declined")).filter(
      (m) => m.toPhone === c.mumPhone,
    );
    expect(sms[0].body).toContain("declined. Reason: Exams on Monday");
  });
});

describe("the collector", () => {
  it("must be a guardian marked authorised to collect", async () => {
    const c = await child(A);
    await expect(
      requestLeaveout(
        deps,
        A.teacher.actor,
        parseLeaveoutInput({
          studentId: c.student.id,
          reasonId: await reasonId(A),
          leaveAt: nairobi(2),
          returnAt: nairobi(30),
          collector: `link:${c.father.id}`,
        }),
      ),
    ).rejects.toThrow(/not marked as authorised to collect/);
  });

  it("or someone the parent approves by SMS reply, before an approver can approve", async () => {
    const c = await child(A);
    const l = await requestLeaveout(
      deps,
      A.teacher.actor,
      parseLeaveoutInput({
        studentId: c.student.id,
        reasonId: await reasonId(A),
        leaveAt: nairobi(2),
        returnAt: nairobi(30),
        collector: "other",
        otherName: "Peter Kariuki",
        otherPhone: "0712 999 888",
        otherRelationship: "Uncle",
      }),
    );
    expect(l.status).toBe("awaiting_parent");
    await expect(approveLeaveout(deps, A.approver.actor, l.id)).rejects.toThrow(
      /parent has not approved/,
    );
    const ask = (await messagesTo(A.school.id, "leaveout_collector_confirm")).find(
      (m) => m.toPhone === c.mumPhone,
    )!;
    expect(ask.body).toContain(`Peter Kariuki (0712999888) is named to collect Amani`);
    expect(ask.body).toContain(`Reply YES ${l.collectorConfirmCode}`);

    // A reply from a number that is not the child's guardian changes nothing.
    expect(await smsCollectorReply(app, randomPhone(), `YES ${l.collectorConfirmCode}`)).toBeNull();
    expect(await smsCollectorReply(app, c.mumPhone, `yes ${l.collectorConfirmCode}`)).toMatchObject(
      { yes: true },
    );
    expect((await owner.leaveout.findUniqueOrThrow({ where: { id: l.id } })).status).toBe(
      "pending",
    );
    await approveLeaveout(deps, A.approver.actor, l.id);
  });
});

describe("the gate pass", () => {
  it("is a signed token with no student details, checked offline with the school's public key", async () => {
    const c = await child(A, { name: "Zawadi" });
    const pass = await approvedPass(A, c);
    expect(pass.token).not.toContain("Zawadi");
    expect(parsePass(pass.token)).toMatchObject({ schoolId: A.school.id, leaveoutId: pass.id });
    const bundle = await gateBundle(deps, A.guard.actor);
    expect(await verifyPass(pass.token, bundle.publicKey!)).toBe("valid");
    // A changed character, or another school's key, fails.
    const tampered = pass.token.slice(0, -3) + (pass.token.endsWith("A") ? "BBB" : "AAA");
    expect(await verifyPass(tampered, bundle.publicKey!)).toBe("invalid");
    const bBundle = await gateBundle(deps, B.guard.actor);
    if (!bBundle.publicKey) {
      const cb = await child(B);
      await approvedPass(B, cb);
    }
    const bKey = (await gateBundle(deps, B.guard.actor)).publicKey!;
    expect(await verifyPass(pass.token, bKey)).toBe("invalid");
    // The bundle has the photo, the window and the pickup code's hash (never the code).
    const entry = bundle.passes.find((p) => p.id === pass.id)!;
    expect(entry).toMatchObject({
      studentName: "Zawadi Mwangi",
      collectorName: "Mary Mwangi",
      status: "approved",
    });
    expect(entry.pickupCodeHash).toBe(await pickupCodeHash(pass.id, pass.code));
    expect(JSON.stringify(entry)).not.toContain(`"${pass.code}"`);
    // The collector got the pickup code by SMS (critical).
    const sms = (await messagesTo(A.school.id, "leaveout_pickup_code")).find((m) =>
      m.body.includes(pass.code),
    )!;
    expect(sms).toMatchObject({ toPhone: c.mumPhone, critical: true });
  });

  it("rejects cancelled, expired, too early and used passes", () => {
    const now = new Date("2026-11-13T12:00:00+03:00");
    const p = { leaveAt: "2026-11-13T14:00:00+03:00", returnAt: "2026-11-15T17:00:00+03:00" };
    expect(passVerdict({ ...p, status: "approved" }, now)).toEqual({
      valid: true,
      action: "exit",
      late: false,
    });
    expect(
      passVerdict({ ...p, status: "approved" }, new Date("2026-11-13T09:00:00+03:00")),
    ).toEqual({ valid: false, reason: "too_early" });
    expect(
      passVerdict({ ...p, status: "approved" }, new Date("2026-11-16T09:00:00+03:00")),
    ).toEqual({ valid: false, reason: "expired" });
    expect(passVerdict({ ...p, status: "cancelled" }, now)).toEqual({
      valid: false,
      reason: "cancelled",
    });
    expect(passVerdict({ ...p, status: "returned" }, now)).toEqual({
      valid: false,
      reason: "used",
    });
    expect(passVerdict({ ...p, status: "pending" }, now)).toEqual({
      valid: false,
      reason: "not_approved",
    });
    expect(passVerdict(null, now)).toEqual({ valid: false, reason: "not_found" });
    expect(passVerdict({ ...p, status: "out" }, new Date("2026-11-16T09:00:00+03:00"))).toEqual({
      valid: true,
      action: "return",
      late: true,
    });
  });
});

describe("exit and return", () => {
  it("a wrong pickup code blocks the exit; the right one lets the child out and tells the parent", async () => {
    const c = await child(A, { name: "Baraka" });
    const pass = await approvedPass(A, c);
    const at = new Date().toISOString();
    const wrong = pass.code === "1111" ? "2222" : "1111";
    expect(
      await recordGateEvents(deps, A.guard.actor, [
        { id: crypto.randomUUID(), leaveoutId: pass.id, kind: "exit", at, code: wrong },
      ]),
    ).toEqual([{ id: expect.any(String), ok: false, error: "Wrong pickup code." }]);
    expect((await owner.leaveout.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe(
      "approved",
    );

    const [ok] = await recordGateEvents(deps, A.guard.actor, [
      { id: crypto.randomUUID(), leaveoutId: pass.id, kind: "exit", at, code: pass.code },
    ]);
    expect(ok).toMatchObject({ ok: true });
    const out = await owner.leaveout.findUniqueOrThrow({ where: { id: pass.id } });
    expect(out.status).toBe("out");
    const exitSms = (await messagesTo(A.school.id, "leaveout_exit")).find(
      (m) => m.toPhone === c.mumPhone,
    )!;
    expect(exitSms.body).toMatch(
      new RegExp(`^Baraka left ${A.school.name} at \\d{2}:\\d{2} with Mary Mwangi\\.$`),
    );
    expect(exitSms.critical).toBe(true);

    // The same pass again: no second exit; then the return.
    const [again] = await recordGateEvents(deps, A.guard.actor, [
      { id: crypto.randomUUID(), leaveoutId: pass.id, kind: "exit", at, code: pass.code },
    ]);
    expect(again.conflict).toMatch(/Already let out/);
    await recordGateEvents(deps, A.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "return",
        at: new Date().toISOString(),
      },
    ]);
    const back = (await messagesTo(A.school.id, "leaveout_return")).find(
      (m) => m.toPhone === c.mumPhone,
    )!;
    expect(back.body).toMatch(/^Baraka is back at school, \d{2}:\d{2}\.$/);
    // Used: a third scan is refused.
    const [used] = await recordGateEvents(deps, A.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "return",
        at: new Date().toISOString(),
      },
    ]);
    expect(used.conflict).toMatch(/Already marked back/);
    expect(
      await owner.message.count({
        where: { schoolId: A.school.id, templateKey: "leaveout_exit", toPhone: c.mumPhone },
      }),
    ).toBe(1);
  });

  it("speaks the parent's language", async () => {
    const c = await child(A, { name: "Neema", language: "sw" });
    const pass = await approvedPass(A, c);
    await recordGateEvents(deps, A.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "exit",
        at: new Date().toISOString(),
        code: pass.code,
      },
    ]);
    const sms = (await messagesTo(A.school.id, "leaveout_exit")).find(
      (m) => m.toPhone === c.mumPhone,
    )!;
    expect(sms.body).toMatch(
      new RegExp(`^Neema ametoka ${A.school.name} saa \\d{2}:\\d{2} pamoja na Mary Mwangi\\.$`),
    );
  });

  it("refuses a cancelled pass online", async () => {
    const c = await child(A);
    const pass = await approvedPass(A, c);
    await cancelLeaveout(deps, A.approver.actor, pass.id, "Plans changed");
    const [r] = await recordGateEvents(deps, A.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "exit",
        at: new Date().toISOString(),
        code: pass.code,
      },
    ]);
    expect(r).toMatchObject({ ok: false, error: "Not valid: cancelled." });
  });

  it("syncs offline events once, and flags a pass cancelled while the gate was offline", async () => {
    const c = await child(A, { name: "Imani" });
    const pass = await approvedPass(A, c);
    await cancelLeaveout(deps, A.approver.actor, pass.id, "Changed plans"); // the gate did not know
    const event = {
      id: crypto.randomUUID(),
      leaveoutId: pass.id,
      kind: "exit" as const,
      at: new Date(Date.now() - 600_000).toISOString(),
      code: pass.code,
      offline: true,
    };
    const [first] = await recordGateEvents(deps, A.guard.actor, [event]);
    expect(first).toMatchObject({
      ok: true,
      conflict: expect.stringMatching(/cancelled while the gate was offline/),
    });
    const [repeat] = await recordGateEvents(deps, A.guard.actor, [event]); // the phone synced twice
    expect(repeat).toMatchObject({ ok: true });
    expect(await owner.leaveoutEvent.count({ where: { leaveoutId: pass.id } })).toBe(1);
    const row = await owner.leaveout.findUniqueOrThrow({ where: { id: pass.id } });
    expect(row.status).toBe("out"); // the child did leave: the record says so
    const notes = await owner.notification.findMany({
      where: { schoolId: A.school.id, title: "Gate conflict" },
    });
    expect(notes.some((n) => n.body.includes("Imani Mwangi"))).toBe(true);
    // The boarding master gets it (not the class teacher).
    const ids = new Set(notes.map((n) => n.membershipId));
    expect(ids.has(A.boardingMaster.membership.id)).toBe(true);
    expect(ids.has(A.teacher.membership.id)).toBe(false);
  });
});

describe("who is out, and late returns", () => {
  it("lists students out, and alerts once when one is not back on time", async () => {
    const c = await child(A, { name: "Juma" });
    const pass = await approvedPass(A, c, { leave: -0.5, back: 0.25 });
    await recordGateEvents(deps, A.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "exit",
        at: new Date().toISOString(),
        code: pass.code,
      },
    ]);
    const lists = await leaveoutLists(deps, A.director.actor);
    expect(lists.out.find((x) => x.id === pass.id)).toMatchObject({
      overdue: false,
      collectorName: "Mary Mwangi",
    });

    const later = new Date(Date.now() + 3600_000);
    expect(await checkOverdueLeaveouts(app, later)).toBeGreaterThanOrEqual(1);
    expect(await checkOverdueLeaveouts(app, later)).toBe(0); // once only
    const notes = await owner.notification.findMany({
      where: { schoolId: A.school.id, title: "Not back on time" },
    });
    const ids = new Set(
      notes.filter((n) => n.body.includes("Juma Mwangi")).map((n) => n.membershipId),
    );
    expect(ids.has(A.boardingMaster.membership.id)).toBe(true);
    expect(ids.has(A.director.membership.id)).toBe(true);
    const sms = (await messagesTo(A.school.id, "leaveout_overdue")).find(
      (m) => m.toPhone === c.mumPhone,
    )!;
    expect(sms.body).toContain("Juma was due back at");
    expect(sms.critical).toBe(true);
  });
});

describe("the gate guard", () => {
  it("cannot open students, fees or medical notes", async () => {
    const c = await child(A);
    await expect(listStudents(deps, A.guard.actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getStudent(deps, A.guard.actor, c.student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getStatement(deps, A.guard.actor, c.student.id)).rejects.toThrow();
    // Even straight queries see nothing.
    const asGuard = scopedDb(app, { userId: A.guard.user.id, schoolId: A.school.id });
    expect(await asGuard.student.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await asGuard.studentMedical.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await asGuard.ledgerLine.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    expect(await asGuard.guardianLink.findMany({ where: { schoolId: A.school.id } })).toEqual([]);
    // ...but the gate works.
    await expect(gateBundle(deps, A.guard.actor)).resolves.toBeTruthy();
  });

  it("searches today's passes when a QR code is damaged", async () => {
    const c = await child(A, { name: "Halima" });
    await approvedPass(A, c);
    const hits = await searchGatePasses(deps, A.guard.actor, "halima");
    expect(hits.map((h) => h.studentName)).toContain("Halima Mwangi");
  });
});

describe("school walls", () => {
  it("School B cannot check, see or use School A's passes", async () => {
    const c = await child(A, { name: "Akinyi" });
    const pass = await approvedPass(A, c);
    expect(await gatePass(deps, B.guard.actor, pass.token)).toBeNull();
    const bBundle = await gateBundle(deps, B.guard.actor);
    expect(bBundle.passes.some((p) => p.id === pass.id)).toBe(false);
    const [r] = await recordGateEvents(deps, B.guard.actor, [
      {
        id: crypto.randomUUID(),
        leaveoutId: pass.id,
        kind: "exit",
        at: new Date().toISOString(),
        code: pass.code,
      },
    ]);
    expect(r).toMatchObject({ ok: false, error: "Pass not found." });
    expect(await searchGatePasses(deps, B.guard.actor, "Akinyi")).toEqual([]);
    expect(await getLeaveout(deps, B.director.actor, pass.id)).toBeNull();
  });
});

describe("parents", () => {
  it("request from the portal; it waits for an approver; the approved pass appears for them", async () => {
    const c = await child(A, { name: "Amani" });
    const id = await parentRequestLeaveout(deps, c.mumId, c.mother.id, {
      reasonId: await reasonId(A, "Family event"),
      details: "Grandmother's birthday",
      leaveAt: nairobi(26),
      returnAt: nairobi(50),
      collector: `link:${c.mother.id}`,
    });
    const before = await parentLeaveouts(deps, c.mumId, c.mother.id);
    expect(before.find((l) => l.id === id)).toMatchObject({
      status: "pending",
      passToken: null,
      requestedVia: "parent",
    });
    const waiting = (await leaveoutLists(deps, A.approver.actor)).waiting.find((l) => l.id === id);
    expect(waiting).toMatchObject({ reason: "Family event", collectorName: "Mary Mwangi" });
    await approveLeaveout(deps, A.approver.actor, id);
    const after = (await parentLeaveouts(deps, c.mumId, c.mother.id)).find((l) => l.id === id)!;
    expect(after.status).toBe("approved");
    expect(parsePass(after.passToken!)).toMatchObject({ leaveoutId: id });
    // The father is not authorised to collect: a parent cannot name him that way.
    await expect(
      parentRequestLeaveout(deps, c.mumId, c.mother.id, {
        reasonId: await reasonId(A),
        leaveAt: nairobi(26),
        returnAt: nairobi(50),
        collector: `link:${c.father.id}`,
      }),
    ).rejects.toThrow("collector");
  });

  it("see nothing, and cannot request, when the school has not switched boarding on", async () => {
    const c = await child(B);
    await owner.school.update({ where: { id: B.school.id }, data: { modules: [] } });
    await expect(
      parentRequestLeaveout(deps, c.mumId, c.mother.id, {
        reasonId: await reasonId(B),
        leaveAt: nairobi(26),
        returnAt: nairobi(50),
        collector: `link:${c.mother.id}`,
      }),
    ).rejects.toThrow("not_allowed");
    expect(await parentLeaveouts(deps, c.mumId, c.mother.id)).toEqual([]);
    await owner.school.update({ where: { id: B.school.id }, data: { modules: ["boarding"] } });
  });
});

describe("half term", () => {
  it("issues approved passes for a whole stream, skipping students with no authorised collector", async () => {
    const f = await makeFixture("Half term");
    const a = await child(f, { name: "Otieno" });
    await child(f, { name: "Wanjiru" });
    const lonely = await makeStudent(f.school.id, f.east.id, {
      firstName: "Kipchoge",
      lastName: "Too",
    });
    const r = await halfTermPasses(deps, f.approver.actor, {
      audience: `stream:${f.east.id}`,
      leaveAt: nairobi(1),
      returnAt: nairobi(100),
    });
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([
      { name: "Kipchoge Too", why: "no guardian marked authorised to collect" },
    ]);
    const rows = await owner.leaveout.findMany({ where: { schoolId: f.school.id } });
    expect(
      rows.every((x) => x.status === "approved" && x.passToken && x.requestedVia === "bulk"),
    ).toBe(true);
    expect(rows.some((x) => x.studentId === lonely.id)).toBe(false);
    expect(
      await owner.message.count({
        where: { schoolId: f.school.id, templateKey: "leaveout_pickup_code" },
      }),
    ).toBe(2);
    expect(rows.find((x) => x.studentId === a.student.id)?.reason).toBe("Half term");
    // Only approvers may do it.
    await expect(
      halfTermPasses(deps, f.boardingMaster.actor, {
        audience: "school",
        leaveAt: nairobi(1),
        returnAt: nairobi(10),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
