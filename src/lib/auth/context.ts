import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, platformDb, type DbContext } from "@/lib/db";
import type { PermissionKey } from "./catalog";
import { ForbiddenError, effectivePermissions } from "./permissions";
import { readSession, setSessionSchool, type SessionRecord } from "./session";

/**
 * The Data Access Layer for "who is asking". Every page and server action starts here, and
 * every permission check happens here on the server. Hiding a button is only a courtesy.
 */

export type CurrentUser = {
  session: SessionRecord;
  id: string;
  name: string;
  phone: string;
  isPlatformAdmin: boolean;
};

export type SchoolContext = {
  user: CurrentUser;
  school: { id: string; name: string; shortName: string; supportAccessUntil: Date | null };
  membershipId: string;
  /** This school's own name for the user (never the platform name). */
  displayName: string;
  roles: { key: string | null; name: string }[];
  permissions: ReadonlySet<PermissionKey>;
  /** Pass to db()/inContext() so row-level security scopes every query to this school. */
  dbContext: DbContext;
};

export type MySchool = {
  school_id: string;
  name: string;
  short_name: string;
  role_names: string[];
};

/**
 * A user's own platform record. The app role cannot read users.name directly (it may have been
 * typed by another school), so this goes through app_me(), which only returns the caller.
 */
export async function getMe(userId: string) {
  const [me] = await db({ userId, schoolId: null }).$queryRaw<
    { id: string; name: string; phone: string; is_platform_admin: boolean }[]
  >`SELECT * FROM app_me()`;
  return me
    ? { id: me.id, name: me.name, phone: me.phone, isPlatformAdmin: me.is_platform_admin }
    : null;
}

/** The signed-in user, or null. Cached for the rest of this request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await getMe(session.userId);
  if (!user) return null;
  return { session, ...user };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new ForbiddenError("platform.admin");
  return user;
}

export async function listMySchools(userId: string): Promise<MySchool[]> {
  return db({ userId, schoolId: null }).$queryRaw<MySchool[]>`SELECT * FROM app_my_schools()`;
}

/** Load the user's school context, or null if they have no (valid) school chosen. */
export const getSchoolContext = cache(async (): Promise<SchoolContext | null> => {
  const user = await getCurrentUser();
  if (!user?.session.schoolId) return null;
  const dbContext: DbContext = { userId: user.id, schoolId: user.session.schoolId };
  const scoped = db(dbContext);

  const [school, membership] = await Promise.all([
    scoped.school.findUnique({ where: { id: dbContext.schoolId! } }),
    scoped.membership.findFirst({
      where: { schoolId: dbContext.schoolId!, userId: user.id, status: "active" },
      include: {
        roles: { include: { role: { include: { permissions: true } } } },
        grants: true,
      },
    }),
  ]);
  // RLS returns nothing if the membership was removed or the school suspended.
  if (!school || !membership) return null;

  const permissions = effectivePermissions({
    rolePermissions: membership.roles.flatMap((r) =>
      r.role.permissions.map((p) => p.permissionKey),
    ),
    grants: membership.grants.map((g) => g.permissionKey),
  });

  return {
    user,
    school: {
      id: school.id,
      name: school.name,
      shortName: school.shortName,
      supportAccessUntil: school.supportAccessUntil,
    },
    membershipId: membership.id,
    displayName: membership.displayName,
    roles: membership.roles.map((r) => ({ key: r.role.key, name: r.role.name })),
    permissions,
    dbContext,
  };
});

/** For pages: the school context, or a redirect to sign in / pick a school. */
export async function requireSchool(): Promise<SchoolContext> {
  const user = await requireUser();
  const ctx = await getSchoolContext();
  if (!ctx) {
    if (user.session.schoolId) await setSessionSchool(user.session.id, null);
    redirect(user.isPlatformAdmin ? "/admin" : "/schools");
  }
  return ctx;
}

/** For server actions and pages: require a permission in the current school. */
export async function requirePermission(key: PermissionKey): Promise<SchoolContext> {
  const ctx = await requireSchool();
  if (!ctx.permissions.has(key)) throw new ForbiddenError(key);
  return ctx;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export { platformDb };
