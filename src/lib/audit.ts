import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db-core";

/**
 * Append one entry to the audit log, inside the same transaction as the change it records,
 * so a change is never saved without its audit entry. Required for every money, marks,
 * leave-out and permissions action.
 */
export type AuditEntry = {
  schoolId: string | null;
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
};

export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      schoolId: entry.schoolId,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip ?? null,
    },
  });
}
