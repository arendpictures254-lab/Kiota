import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import {
  app,
  appUnguarded,
  makeAdmin,
  makeMember,
  makeSchool,
  owner,
  randomPhone,
} from "../../../tests/db-helpers";
import {
  type Actor,
  ValidationError,
  createSchool,
  inviteStaff,
  listStaff,
  setLeaveoutApproval,
  setStaffRoles,
  setSupportAccess,
} from "./service";

const deps = { db: app };
const perms = (...roleKeys: string[]) =>
  effectivePermissions({
    rolePermissions: roleKeys.flatMap((k) => BUILT_IN_ROLES.find((r) => r.key === k)!.permissions),
    grants: [],
  });

let schoolId: string;
let director: Actor;
let bursar: Actor;

beforeAll(async () => {
  schoolId = (await makeSchool(`Staff ${Date.now()}`)).id;
  const d = await makeMember(schoolId, ["director"], "Director");
  const b = await makeMember(schoolId, ["bursar"], "Bursar");
  director = { userId: d.user.id, schoolId, permissions: perms("director"), ip: "127.0.0.1" };
  bursar = { userId: b.user.id, schoolId, permissions: perms("bursar") };
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

describe("inviting staff", () => {
  it("lets the Director invite by phone and name with roles, and audits it", async () => {
    const phone = randomPhone();
    const result = await inviteStaff(deps, director, {
      name: "  New   Teacher ",
      phone: phone.replace("+254", "0"),
      roleKeys: ["class_teacher", "subject_teacher"],
    });
    expect(result.phone).toBe(phone);
    expect(result.alreadyMember).toBe(false);

    const staff = await listStaff(deps, director);
    const row = staff.find((s) => s.membershipId === result.membershipId)!;
    expect(row.name).toBe("New Teacher");
    expect(row.roles.map((r) => r.key).sort()).toEqual(["class_teacher", "subject_teacher"]);

    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId, action: "staff.invite", targetId: result.membershipId },
    });
    expect(log.actorId).toBe(director.userId);
    expect(log.ip).toBe("127.0.0.1");
  });

  it("is refused for a Bursar on the server", async () => {
    await expect(
      inviteStaff(deps, bursar, { name: "X Y", phone: randomPhone(), roleKeys: ["bursar"] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("validates phone, name and roles", async () => {
    await expect(
      inviteStaff(deps, director, { name: "A B", phone: "123", roleKeys: ["bursar"] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      inviteStaff(deps, director, { name: "A B", phone: randomPhone(), roleKeys: [] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      inviteStaff(deps, director, { name: "A B", phone: randomPhone(), roleKeys: ["superuser"] }),
    ).rejects.toThrow(ValidationError);
  });

  it("reuses the platform identity of someone already at another school", async () => {
    const other = await makeSchool(`Other ${Date.now()}`);
    const { user } = await makeMember(other.id, ["bursar"], "Shared Person");
    const result = await inviteStaff(deps, director, {
      name: "Different Name",
      phone: user.phone,
      roleKeys: ["subject_teacher"],
    });
    const m = await owner.membership.findUniqueOrThrow({ where: { id: result.membershipId } });
    expect(m.userId).toBe(user.id);
    // Never overwrites the existing person's name.
    expect((await owner.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(
      "Shared Person",
    );
  });
});

describe("leave-out approval", () => {
  it("the Director can grant it and withdraw it, and both are audited", async () => {
    const { membershipId } = await inviteStaff(deps, director, {
      name: "Matron Jane",
      phone: randomPhone(),
      roleKeys: ["boarding_master"],
    });
    const find = async () =>
      (await listStaff(deps, director)).find((s) => s.membershipId === membershipId)!;

    expect((await find()).canApproveLeaveouts).toBe(false);
    await setLeaveoutApproval(deps, director, membershipId, true);
    expect((await find()).canApproveLeaveouts).toBe(true);
    await setLeaveoutApproval(deps, director, membershipId, false);
    expect((await find()).canApproveLeaveouts).toBe(false);

    const actions = (
      await owner.auditLog.findMany({
        where: { schoolId, targetId: membershipId, action: { startsWith: "permission." } },
        orderBy: { createdAt: "asc" },
      })
    ).map((l) => l.action);
    expect(actions).toEqual(["permission.grant", "permission.withdraw"]);
  });

  it("cannot be granted by anyone who is not a Director", async () => {
    const { membership } = await makeMember(schoolId, ["class_teacher"]);
    const principalWithApproval: Actor = {
      ...bursar,
      permissions: new Set<PermissionKey>([...perms("principal"), "leaveout.approve"]),
    };
    await expect(setLeaveoutApproval(deps, bursar, membership.id, true)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      setLeaveoutApproval(deps, principalWithApproval, membership.id, true),
    ).rejects.toThrow(ForbiddenError);
  });

  it("cannot reach staff in another school", async () => {
    const other = await makeSchool(`Far ${Date.now()}`);
    const { membership } = await makeMember(other.id, ["class_teacher"]);
    await expect(setLeaveoutApproval(deps, director, membership.id, true)).rejects.toThrow(
      ValidationError,
    );
    expect(await owner.permissionGrant.count({ where: { membershipId: membership.id } })).toBe(0);
  });
});

describe("roles", () => {
  it("are changed with before/after in the audit log", async () => {
    const { membershipId } = await inviteStaff(deps, director, {
      name: "Role Change",
      phone: randomPhone(),
      roleKeys: ["subject_teacher"],
    });
    await setStaffRoles(deps, director, membershipId, ["class_teacher", "storekeeper"]);
    const log = await owner.auditLog.findFirstOrThrow({
      where: { schoolId, action: "staff.roles.update", targetId: membershipId },
    });
    expect(log.before).toEqual({ roles: ["subject_teacher"] });
    expect(log.after).toEqual({ roles: ["class_teacher", "storekeeper"] });
  });

  it("keep at least one Director", async () => {
    const solo = await makeSchool(`Solo ${Date.now()}`);
    const d = await makeMember(solo.id, ["director"]);
    const actor: Actor = { userId: d.user.id, schoolId: solo.id, permissions: perms("director") };
    await expect(setStaffRoles(deps, actor, d.membership.id, ["bursar"])).rejects.toThrow(
      /at least one Director/,
    );
  });
});

describe("support access", () => {
  it("only the Director can turn it on, and it is audited", async () => {
    await expect(setSupportAccess(deps, bursar, 24)).rejects.toThrow(ForbiddenError);
    await setSupportAccess(deps, director, 24);
    const school = await owner.school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(school.supportAccessUntil!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600e3);
    await setSupportAccess(deps, director, null);
    expect(
      (await owner.school.findUniqueOrThrow({ where: { id: schoolId } })).supportAccessUntil,
    ).toBeNull();
  });
});

describe("creating schools", () => {
  const input = () => ({
    name: `Pwani Girls ${Date.now()}`,
    shortName: "PWANI",
    county: "Mombasa",
    levelsOffered: ["junior", "senior"],
    directorName: "Halima Omar",
    directorPhone: randomPhone(),
  });

  it("an Arend admin creates a school and its Director", async () => {
    const admin = await makeAdmin();
    const data = input();
    const { schoolId: newId } = await createSchool(
      deps,
      { userId: admin.id, isPlatformAdmin: true },
      data,
    );
    const director = await owner.user.findUniqueOrThrow({ where: { phone: data.directorPhone } });
    const m = await owner.membership.findUniqueOrThrow({
      where: { schoolId_userId: { schoolId: newId, userId: director.id } },
      include: { roles: { include: { role: true } } },
    });
    expect(m.roles.map((r) => r.role.key)).toEqual(["director"]);
    expect(
      await owner.auditLog.count({ where: { schoolId: newId, action: "school.create" } }),
    ).toBe(1);

    // ...but cannot see the new school's data afterwards.
    const { scopedDb } = await import("@/lib/db-core");
    expect(
      await scopedDb(appUnguarded, { userId: admin.id, schoolId: newId }).membership.findMany(),
    ).toEqual([]);
  });

  it("is refused for anyone else, even if the app check were skipped", async () => {
    const { user } = await makeMember(schoolId, ["director"]);
    await expect(
      createSchool(deps, { userId: user.id, isPlatformAdmin: false }, input()),
    ).rejects.toThrow(ForbiddenError);
    // Lying about being an admin is caught by the database.
    await expect(
      createSchool(deps, { userId: user.id, isPlatformAdmin: true }, input()),
    ).rejects.toThrow(/not allowed/);
  });
});
