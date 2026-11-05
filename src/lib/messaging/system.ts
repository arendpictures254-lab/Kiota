/**
 * Kiota's hidden "Automatic messages" member of each school. The sending worker and delivery
 * reports run as this member, so row-level security applies to them like to anyone else.
 * It can never sign in (app_phone_can_sign_in refuses "system:" phones) and is not listed as staff.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";
import { effectivePermissions } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";

export const MESSAGING_PHONE = "system:messaging";
const ROLE = "system_messaging";

export const messagingPermissions = effectivePermissions({
  rolePermissions: BUILT_IN_ROLES.find((r) => r.key === ROLE)!.permissions,
  grants: [],
});

/** Make sure the school has its automatic-messages member. Run inside the school's context. */
export async function ensureMessagingMember(tx: Tx, schoolId: string) {
  const [{ present }] = await tx.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE u.phone = ${MESSAGING_PHONE} AND m.status = 'active'
    ) AS present`;
  if (present) return;
  const [{ id: userId }] = await tx.$queryRaw<{ id: string }[]>`
    SELECT app_ensure_user(${MESSAGING_PHONE}, 'Kiota automatic messages') AS id`;
  const membership = await tx.membership.upsert({
    where: { schoolId_userId: { schoolId, userId } },
    create: { schoolId, userId, displayName: "Messages (automatic)" },
    update: { status: "active" },
  });
  const role = await tx.role.findUniqueOrThrow({ where: { schoolId: null, key: ROLE } });
  await tx.membershipRole.upsert({
    where: { schoolId, membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
    create: { schoolId, membershipId: membership.id, roleId: role.id },
    update: {},
  });
}

/** The school's automatic-messages member as an Actor. */
export async function messagingActor(db: PrismaClient, schoolId: string): Promise<Actor> {
  const [row] = await db.$queryRaw<{ id: string | null }[]>`
    SELECT app_auth_user_id(${MESSAGING_PHONE}) AS id`;
  if (!row?.id) throw new Error("Automatic messages are not set up");
  return { userId: row.id, schoolId, permissions: messagingPermissions, ip: null };
}
