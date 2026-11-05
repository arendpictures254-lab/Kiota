/**
 * Staff and school administration. Every function checks permissions itself (server side),
 * runs in the school's row-level-security context, and writes the audit log in the same
 * transaction. Server actions are thin wrappers around these.
 */
import { audit } from "@/lib/audit";
import { BUILT_IN_ROLES, DIRECTOR_GRANT_ONLY, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, assertCan, canGrant } from "@/lib/auth/permissions";
import { withContext, type Tx } from "@/lib/db-core";
import { normalizePhone } from "@/lib/phone";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";

export { type Actor, ValidationError };

export const LEAVEOUT_APPROVE: PermissionKey = "leaveout.approve";
/** Kiota's own hidden members (automatic payments, automatic messages) are not staff. */
export const SYSTEM_ROLES = BUILT_IN_ROLES.filter((r) => r.hidden).map((r) => r.key);

async function roleIdsFor(tx: Tx, roleKeys: readonly string[]) {
  const unique = [...new Set(roleKeys)];
  if (unique.length === 0) throw new ValidationError("Choose at least one role.", "roles");
  const hidden = BUILT_IN_ROLES.filter((r) => r.hidden).map((r) => r.key);
  if (unique.some((k) => hidden.includes(k))) throw new ValidationError("Unknown role.", "roles");
  const roles = await tx.role.findMany({ where: { key: { in: unique }, schoolId: null } });
  if (roles.length !== unique.length) throw new ValidationError("Unknown role.", "roles");
  return roles;
}

async function rolesOf(tx: Tx, schoolId: string, membershipId: string) {
  const rows = await tx.membershipRole.findMany({
    where: { schoolId, membershipId },
    include: { role: true },
  });
  return rows.map((r) => r.role.key ?? r.role.id).sort();
}

async function activeDirectorCount(tx: Tx, schoolId: string) {
  return tx.membershipRole.count({
    where: { schoolId, role: { key: "director" }, membership: { status: "active" } },
  });
}

export type StaffRow = {
  membershipId: string;
  userId: string;
  name: string;
  phone: string;
  roles: { key: string | null; name: string }[];
  canApproveLeaveouts: boolean;
  /** True if leave-out approval comes from a role (Director) rather than a grant. */
  leaveoutFromRole: boolean;
};

export async function listStaff({ db }: Deps, actor: Actor): Promise<StaffRow[]> {
  assertCan(actor.permissions, "staff.view");
  return withContext(db, ctxOf(actor), async (tx) => {
    const members = await tx.membership.findMany({
      // Kiota's own automatic-payments member is not staff.
      where: {
        schoolId: actor.schoolId,
        status: "active",
        roles: { none: { role: { key: { in: SYSTEM_ROLES } } } },
      },
      include: {
        // Only the phone: schools never read the platform name (memberships.display_name instead).
        user: { select: { phone: true } },
        roles: { include: { role: { include: { permissions: true } } } },
        grants: true,
      },
      orderBy: { displayName: "asc" },
    });
    return members.map((m) => {
      const fromRole = m.roles.some((r) =>
        r.role.permissions.some((p) => p.permissionKey === LEAVEOUT_APPROVE),
      );
      const fromGrant = m.grants.some((g) => g.permissionKey === LEAVEOUT_APPROVE);
      return {
        membershipId: m.id,
        userId: m.userId,
        name: m.displayName,
        phone: m.user.phone,
        roles: m.roles.map((r) => ({ key: r.role.key, name: r.role.name })),
        canApproveLeaveouts: fromRole || fromGrant,
        leaveoutFromRole: fromRole,
      };
    });
  });
}

export async function getStaffMember({ db }: Deps, actor: Actor, membershipId: string) {
  const all = await listStaff({ db }, actor);
  return all.find((s) => s.membershipId === membershipId) ?? null;
}

export type InviteInput = { name: string; phone: string; roleKeys: string[] };

/** Invite a person by phone number and give them roles. Returns the membership id. */
export async function inviteStaff(
  { db }: Deps,
  actor: Actor,
  input: InviteInput,
): Promise<{ membershipId: string; phone: string; alreadyMember: boolean }> {
  assertCan(actor.permissions, "staff.manage");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ValidationError("Enter the person's full name.", "name");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ValidationError("Enter a valid phone number, like 0712 345 678.", "phone");

  return withContext(db, ctxOf(actor), async (tx) => {
    const roles = await roleIdsFor(tx, input.roleKeys);
    const [{ id: userId }] = await tx.$queryRaw<{ id: string }[]>`
      SELECT app_ensure_user(${phone}, ${name}) AS id`;

    const existing = await tx.membership.findUnique({
      where: { schoolId_userId: { schoolId: actor.schoolId, userId } },
    });
    if (existing?.status === "active") {
      return { membershipId: existing.id, phone, alreadyMember: true };
    }
    const membership = existing
      ? await tx.membership.update({
          where: { schoolId: actor.schoolId, id: existing.id },
          data: { status: "active", displayName: name },
        })
      : await tx.membership.create({
          data: { schoolId: actor.schoolId, userId, displayName: name },
        });

    await tx.membershipRole.deleteMany({
      where: { schoolId: actor.schoolId, membershipId: membership.id },
    });
    await tx.membershipRole.createMany({
      data: roles.map((r) => ({
        schoolId: actor.schoolId,
        membershipId: membership.id,
        roleId: r.id,
      })),
    });

    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "staff.invite",
      targetType: "membership",
      targetId: membership.id,
      after: { userId, name, phone, roles: roles.map((r) => r.key!).sort() },
      ip: actor.ip,
    });
    return { membershipId: membership.id, phone, alreadyMember: false };
  });
}

export async function setStaffRoles(
  { db }: Deps,
  actor: Actor,
  membershipId: string,
  roleKeys: string[],
): Promise<void> {
  assertCan(actor.permissions, "staff.manage");
  await withContext(db, ctxOf(actor), async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { schoolId: actor.schoolId, id: membershipId },
    });
    if (!membership || membership.status !== "active") {
      throw new ValidationError("Staff member not found.");
    }
    const roles = await roleIdsFor(tx, roleKeys);
    const before = await rolesOf(tx, actor.schoolId, membershipId);

    await tx.membershipRole.deleteMany({ where: { schoolId: actor.schoolId, membershipId } });
    await tx.membershipRole.createMany({
      data: roles.map((r) => ({ schoolId: actor.schoolId, membershipId, roleId: r.id })),
    });

    if ((await activeDirectorCount(tx, actor.schoolId)) === 0) {
      throw new ValidationError("A school must always have at least one Director.", "roles");
    }

    const after = await rolesOf(tx, actor.schoolId, membershipId);
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "staff.roles.update",
      targetType: "membership",
      targetId: membershipId,
      before: { roles: before },
      after: { roles: after },
      ip: actor.ip,
    });
  });
}

/**
 * Grant or withdraw "can approve leave-outs" for one person. Director only.
 * Withdrawing takes effect on that person's next request.
 */
export async function setLeaveoutApproval(
  { db }: Deps,
  actor: Actor,
  membershipId: string,
  allow: boolean,
): Promise<void> {
  if (!canGrant(actor.permissions, LEAVEOUT_APPROVE)) throw new ForbiddenError("leaveout.grant");
  if (!DIRECTOR_GRANT_ONLY.includes(LEAVEOUT_APPROVE)) throw new Error("catalogue mismatch");

  await withContext(db, ctxOf(actor), async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { schoolId: actor.schoolId, id: membershipId },
    });
    if (!membership || membership.status !== "active") {
      throw new ValidationError("Staff member not found.");
    }
    const key = { membershipId_permissionKey: { membershipId, permissionKey: LEAVEOUT_APPROVE } };
    const existing = await tx.permissionGrant.findUnique({
      where: { ...key, schoolId: actor.schoolId },
    });
    if (allow === !!existing) return; // nothing to change

    if (allow) {
      await tx.permissionGrant.create({
        data: {
          schoolId: actor.schoolId,
          membershipId,
          permissionKey: LEAVEOUT_APPROVE,
          grantedById: actor.userId,
        },
      });
    } else {
      await tx.permissionGrant.delete({ where: { ...key, schoolId: actor.schoolId } });
    }

    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: allow ? "permission.grant" : "permission.withdraw",
      targetType: "membership",
      targetId: membershipId,
      before: { [LEAVEOUT_APPROVE]: !allow },
      after: { [LEAVEOUT_APPROVE]: allow },
      ip: actor.ip,
    });
  });
}

/** Turn Arend Studio support access on for `hours`, or off (null). */
export async function setSupportAccess(
  { db }: Deps,
  actor: Actor,
  hours: number | null,
): Promise<void> {
  assertCan(actor.permissions, "school.settings.manage");
  if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 72)) {
    throw new ValidationError("Support access can be turned on for 1 to 72 hours.");
  }
  await withContext(db, ctxOf(actor), async (tx) => {
    const school = await tx.school.findUniqueOrThrow({ where: { id: actor.schoolId } });
    const until = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000);
    await tx.school.update({ where: { id: actor.schoolId }, data: { supportAccessUntil: until } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "school.support_access",
      targetType: "school",
      targetId: actor.schoolId,
      before: { supportAccessUntil: school.supportAccessUntil?.toISOString() ?? null },
      after: { supportAccessUntil: until?.toISOString() ?? null },
      ip: actor.ip,
    });
  });
}

export type CreateSchoolInput = {
  name: string;
  shortName: string;
  county: string;
  levelsOffered: string[];
  directorName: string;
  directorPhone: string;
};

/** Arend admin only. Creates the school and makes the given person its Director. */
export async function createSchool(
  { db }: Deps,
  admin: { userId: string; isPlatformAdmin: boolean; ip?: string | null },
  input: CreateSchoolInput,
): Promise<{ schoolId: string; directorPhone: string }> {
  if (!admin.isPlatformAdmin) throw new ForbiddenError("platform.admin");
  const name = input.name.trim();
  const shortName = input.shortName.trim().toUpperCase();
  const county = input.county.trim();
  const directorName = input.directorName.trim();
  const directorPhone = normalizePhone(input.directorPhone);
  if (name.length < 3) throw new ValidationError("Enter the school's name.", "name");
  if (!/^[A-Z0-9 ]{3,11}$/.test(shortName)) {
    throw new ValidationError(
      "Short name: 3 to 11 letters or numbers (it appears as the SMS sender).",
      "shortName",
    );
  }
  if (county.length < 3) throw new ValidationError("Enter the county.", "county");
  if (input.levelsOffered.length === 0) {
    throw new ValidationError("Choose at least one level.", "levelsOffered");
  }
  if (directorName.length < 2)
    throw new ValidationError("Enter the Director's name.", "directorName");
  if (!directorPhone) throw new ValidationError("Enter a valid phone number.", "directorPhone");

  const [{ id }] = await withContext(
    db,
    { userId: admin.userId, schoolId: null },
    (tx) =>
      tx.$queryRaw<{ id: string }[]>`
      SELECT app_create_school(${name}, ${shortName}, ${county}, ${input.levelsOffered}::text[],
                               ${directorPhone}, ${directorName}, ${admin.ip ?? null}) AS id`,
  );
  return { schoolId: id, directorPhone };
}

export const MODULES = [
  { key: "academics", label: "Academics (report cards)" },
  { key: "boarding", label: "Boarding (leave-outs)" },
  { key: "pocket_money", label: "Pocket money" },
] as const;

/** Arend admin: switch optional modules on for a school (the parent portal shows them). */
export async function setSchoolModules(
  { db }: Deps,
  admin: { userId: string; isPlatformAdmin: boolean; ip?: string | null },
  schoolId: string,
  modules: string[],
) {
  if (!admin.isPlatformAdmin) throw new ForbiddenError("platform.admin");
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) throw new ValidationError("School not found.");
  await withContext(
    db,
    { userId: admin.userId, schoolId: null },
    (tx) =>
      tx.$executeRaw`SELECT app_admin_set_school_modules(${schoolId}::uuid, ${modules}::text[], ${admin.ip ?? null})`,
  );
}
