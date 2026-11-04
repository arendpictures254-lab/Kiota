/**
 * Pure permission logic. No database access here, so it is easy to unit test.
 * Server code loads a member's role permissions and direct grants, then asks these.
 */
import { DIRECTOR_GRANT_ONLY, type PermissionKey, isPermissionKey } from "./catalog";

export type Access = {
  /** Permissions from all of the member's roles. */
  rolePermissions: readonly string[];
  /** Permissions granted to this person directly (e.g. leaveout.approve). */
  grants: readonly string[];
};

export function effectivePermissions(access: Access): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  for (const key of [...access.rolePermissions, ...access.grants]) {
    if (isPermissionKey(key)) result.add(key);
  }
  return result;
}

export function can(permissions: ReadonlySet<PermissionKey>, key: PermissionKey): boolean {
  return permissions.has(key);
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super(`Not allowed: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(permissions: ReadonlySet<PermissionKey>, key: PermissionKey): void {
  if (!permissions.has(key)) throw new ForbiddenError(key);
}

/**
 * May `granter` give or withdraw `permission` to someone, one person at a time?
 * Only director-grant-only permissions can be granted this way, and only by holders of
 * "leaveout.grant" (the Director role).
 */
export function canGrant(granter: ReadonlySet<PermissionKey>, permission: string): boolean {
  if (!isPermissionKey(permission)) return false;
  if (!DIRECTOR_GRANT_ONLY.includes(permission)) return false;
  return granter.has("leaveout.grant");
}
