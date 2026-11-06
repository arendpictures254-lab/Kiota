/**
 * Leave-out messages. SMS are queued as the school's automatic-messages member (it may read
 * guardians; a gate guard may not), in each guardian's language, through the normal outbox
 * (wallet, quiet hours: exit, return, pickup code and overdue are critical and go at once).
 * Staff are told in the app (notifications), chosen by permission, never by role name.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { PermissionKey } from "@/lib/auth/catalog";
import { type Tx, withContext } from "@/lib/db-core";
import {
  type Draft,
  type Recipient,
  guardianRecipients,
  planDrafts,
  queuePlanned,
} from "@/lib/messaging/outbox";
import { messagingActor } from "@/lib/messaging/system";
import type { TemplateVars } from "@/lib/messaging/templates";
import { timeOfDay, whenText } from "./rules";

type LeaveoutRow = {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  collectorName: string;
  collectorPhone: string;
  collectorLinkId: string | null;
  leaveAt: Date;
  returnAt: Date;
};

const firstName = (full: string) => full.split(" ")[0] ?? full;

/**
 * Queue a leave-out SMS to the child's guardians who receive boarding messages ("parents"), or
 * to the collector. `vars` gets each recipient's language (dates are written in it).
 */
export async function sendLeaveoutSms(
  db: PrismaClient,
  l: LeaveoutRow,
  templateKey: string,
  to: "parents" | "collector",
  vars: (lang: "en" | "sw") => TemplateVars,
  opts: { now?: Date; createdById?: string } = {},
) {
  const actor = await messagingActor(db, l.schoolId);
  return withContext(db, { userId: actor.userId, schoolId: l.schoolId }, async (tx) => {
    const school = await tx.school.findUniqueOrThrow({
      where: { id: l.schoolId },
      select: { name: true },
    });
    let recipients: Recipient[];
    if (to === "parents") {
      recipients = await guardianRecipients(
        tx,
        { schoolId: l.schoolId, studentIds: [l.studentId] },
        "boarding",
      );
    } else {
      const link = l.collectorLinkId
        ? await tx.guardianLink.findUnique({
            where: { schoolId: l.schoolId, id: l.collectorLinkId },
            select: { language: true, whatsapp: true },
          })
        : null;
      recipients = [
        {
          guardianLinkId: l.collectorLinkId,
          studentId: l.studentId,
          phone: l.collectorPhone,
          language: link?.language === "sw" ? "sw" : "en",
          whatsapp: false,
        },
      ];
    }
    const seen = new Set<string>();
    const drafts: Draft[] = recipients
      .filter((r) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)))
      .map((r) => ({
        recipient: r,
        templateKey,
        channel: "sms",
        vars: { school: school.name, student: firstName(l.studentName), ...vars(r.language) },
      }));
    if (drafts.length === 0) return { queued: 0 };
    const { planned } = await planDrafts(tx, l.schoolId, drafts);
    return queuePlanned(tx, {
      schoolId: l.schoolId,
      planned,
      mode: "each",
      now: opts.now,
      createdById: opts.createdById ?? actor.userId,
    });
  });
}

export const leaveoutVars = {
  when: (d: Date, lang: "en" | "sw") => whenText(d, lang),
  time: (d: Date) => timeOfDay(d),
};

/** In-app notifications to everyone in the school with one of these permissions. */
export async function notifyStaffWith(
  tx: Tx,
  schoolId: string,
  permissions: PermissionKey[],
  note: { title: string; body: string; link?: string },
  exceptUserIds: string[] = [],
) {
  const members = await tx.membership.findMany({
    where: {
      schoolId,
      status: "active",
      userId: { notIn: exceptUserIds },
      roles: { none: { role: { key: { in: ["system_payments", "system_messaging"] } } } },
      OR: [
        {
          roles: {
            some: { role: { permissions: { some: { permissionKey: { in: permissions } } } } },
          },
        },
        { grants: { some: { permissionKey: { in: permissions } } } },
      ],
    },
    select: { id: true },
  });
  if (members.length === 0) return 0;
  await tx.notification.createMany({
    data: members.map((m) => ({ schoolId, membershipId: m.id, ...note })),
  });
  return members.length;
}

/** In-app notification to one staff member (by user), if they work at this school. */
export async function notifyUser(
  tx: Tx,
  schoolId: string,
  userId: string,
  note: { title: string; body: string; link?: string },
) {
  const m = await tx.membership.findFirst({
    where: { schoolId, userId, status: "active" },
    select: { id: true },
  });
  // createMany: no RETURNING (staff may write a colleague's notification but read only their own).
  if (m) await tx.notification.createMany({ data: [{ schoolId, membershipId: m.id, ...note }] });
}
