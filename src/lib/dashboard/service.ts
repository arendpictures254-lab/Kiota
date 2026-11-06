/**
 * The dashboard's "control room": key numbers and what is happening now, for whoever is signed
 * in. Each part appears only for people with the permission behind it (the Director sees all of
 * it; a Bursar sees fees; a class teacher their students), and is read in the school's
 * row-level-security context.
 */
import { withContext } from "@/lib/db-core";
import { collectedVsExpected } from "@/lib/fees/reports";
import { canSeeLeaveouts } from "@/lib/leaveout/service";
import { walletBalance } from "@/lib/messaging/outbox";
import { canSeeMessages } from "@/lib/messaging/service";
import { type Actor, type Deps, ctxOf } from "@/lib/service-kit";

export async function dashboardOverview(deps: Deps, actor: Actor, now = new Date()) {
  const p = actor.permissions;
  const s = actor.schoolId;
  const data = await withContext(deps.db, ctxOf(actor), async (tx) => {
    const terms = p.has("fees.reports")
      ? await tx.term.findMany({
          where: { schoolId: s },
          select: { id: true, startDate: true, endDate: true },
          orderBy: { startDate: "asc" },
        })
      : [];
    // This term; else the next one; else the last one.
    const term =
      terms.find((t) => t.startDate <= now && now <= t.endDate) ??
      terms.find((t) => t.startDate > now) ??
      terms.at(-1) ??
      null;
    const students = p.has("students.view") || p.has("students.view.own_streams");
    const [studentCount, staffCount, outCount, wallet, payments, waiting, notices] =
      await Promise.all([
        students ? tx.student.count({ where: { schoolId: s, status: "active" } }) : null,
        p.has("staff.view")
          ? tx.membership.count({
              where: {
                schoolId: s,
                status: "active",
                roles: { none: { role: { key: { in: ["system_payments", "system_messaging"] } } } },
              },
            })
          : null,
        canSeeLeaveouts(p) ? tx.leaveout.count({ where: { schoolId: s, status: "out" } }) : null,
        canSeeMessages(p) ? walletBalance(tx, s) : null,
        p.has("fees.view") || p.has("fees.collect")
          ? tx.payment.findMany({
              where: { schoolId: s },
              orderBy: { createdAt: "desc" },
              take: 6,
              select: {
                id: true,
                amountCents: true,
                method: true,
                paidAt: true,
                studentId: true,
                receipt: { select: { id: true, number: true } },
                reversal: { select: { id: true } },
              },
            })
          : null,
        canSeeLeaveouts(p)
          ? tx.leaveout.findMany({
              where: { schoolId: s, status: { in: ["pending", "awaiting_parent"] } },
              orderBy: { leaveAt: "asc" },
              take: 6,
              select: {
                id: true,
                studentName: true,
                classLabel: true,
                reason: true,
                leaveAt: true,
                status: true,
              },
            })
          : null,
        canSeeMessages(p)
          ? tx.messageCampaign.findMany({
              where: { schoolId: s, kind: "notice" },
              orderBy: { createdAt: "desc" },
              take: 4,
              select: { id: true, title: true, recipients: true, createdAt: true },
            })
          : null,
      ]);
    const names = payments?.length
      ? await tx.student.findMany({
          where: { schoolId: s, id: { in: [...new Set(payments.map((x) => x.studentId))] } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const reads = notices?.length
      ? await tx.noticeRead.groupBy({
          by: ["campaignId"],
          where: { schoolId: s, campaignId: { in: notices.map((n) => n.id) } },
          _count: { _all: true },
        })
      : [];
    return {
      termId: term?.id ?? null,
      studentCount,
      staffCount,
      outCount,
      wallet,
      payments: payments?.map((x) => {
        const st = names.find((n) => n.id === x.studentId);
        return { ...x, studentName: st ? `${st.firstName} ${st.lastName}` : "A student" };
      }),
      waiting,
      notices: notices?.map((n) => ({
        ...n,
        reads: reads.find((r) => r.campaignId === n.id)?._count._all ?? 0,
      })),
    };
  });
  const fees = data.termId
    ? await collectedVsExpected(deps, actor, data.termId).catch(() => null)
    : null;
  return { ...data, fees: fees ? { term: fees.term.name, ...fees.totals } : null };
}
