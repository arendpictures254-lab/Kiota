/**
 * Development seed for the parent portal (runs as the owner, idempotent).
 *
 *  - Wanjiku Kamau (0744 000 001): Brian at Bahari Academy (confirmed, with receipts, a balance
 *    carried from 2026 Term 3 that is overdue, and unread notices) and Joy at Milima School
 *    (still waiting for her to confirm, from the students seed).
 *  - Kilifi Education Trust (0755 000 001): a sponsor of Otieno at Bahari who sees fees only.
 *  - Grace Wanjiru (0711 000 003): class teacher at Bahari and mother of Kibet there, so she
 *    chooses "Staff" or "Parent" after signing in.
 *  - Bahari Academy has the academics and boarding modules on (their portal sections show as
 *    "coming soon"); Milima School has neither.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { BUILT_IN_ROLES } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { createAppClient, type Tx } from "../src/lib/db-core";
import { postEntry } from "../src/lib/fees/ledger";
import { parseNoticeInput, sendNotice } from "../src/lib/messaging/service";
import { processDueMessages } from "../src/lib/messaging/worker";
import { setSmsDriverForTests } from "../src/lib/sms";
import { consoleDriver } from "../src/lib/sms/console-driver";
import { setWhatsAppDriverForTests } from "../src/lib/whatsapp";

export const PORTAL_SEED = {
  wanjiku: { phone: "+254744000001", child: "BA/2024/101" },
  sponsor: { phone: "+254755000001", name: "Kilifi Education Trust", child: "BA/2025/010" },
  teacherParent: { phone: "+254711000003", name: "Grace Wanjiru", child: "BA/2025/020" },
};

const ARREARS_NOTE = "Balance carried from 2026 (before Kiota)";
const NOTICE = "Grade 8 East: the class trip to Gede Ruins is on Friday. Pack lunch and a hat.";

async function student(owner: PrismaClient, schoolId: string, admissionNumber: string) {
  return owner.student.findUnique({
    where: { schoolId_admissionNumber: { schoolId, admissionNumber } },
  });
}

async function link(
  owner: PrismaClient,
  schoolId: string,
  studentId: string,
  who: { phone: string; name: string },
  data: {
    relationship: "mother" | "sponsor";
    receivesFees: boolean;
    receivesAcademics: boolean;
    receivesBoarding: boolean;
  },
) {
  const user = await owner.user.upsert({
    where: { phone: who.phone },
    create: { phone: who.phone, name: who.name },
    update: {},
  });
  await owner.guardianLink.upsert({
    where: { studentId_userId: { studentId, userId: user.id } },
    create: { schoolId, studentId, userId: user.id, name: who.name, language: "en", ...data },
    update: {},
  });
}

export async function seedPortal(owner: PrismaClient, schoolIds: Map<string, string>) {
  const bahari = schoolIds.get("Bahari Academy")!;
  await owner.school.update({
    where: { id: bahari },
    data: { modules: ["academics", "boarding"] },
  });

  const sponsored = await student(owner, bahari, PORTAL_SEED.sponsor.child);
  if (sponsored) {
    await link(owner, bahari, sponsored.id, PORTAL_SEED.sponsor, {
      relationship: "sponsor",
      receivesFees: true,
      receivesAcademics: false,
      receivesBoarding: false,
    });
  }
  const kibet = await student(owner, bahari, PORTAL_SEED.teacherParent.child);
  if (kibet) {
    await link(owner, bahari, kibet.id, PORTAL_SEED.teacherParent, {
      relationship: "mother",
      receivesFees: true,
      receivesAcademics: true,
      receivesBoarding: true,
    });
  }

  // Brian's balance from before Kiota: overdue already (the 2027 instalments are not due yet).
  const brian = await student(owner, bahari, PORTAL_SEED.wanjiku.child);
  const arrears = await owner.voteHead.findFirst({ where: { schoolId: bahari, isArrears: true } });
  const bursar = await owner.user.findUnique({ where: { phone: "+254711000002" } });
  if (brian && arrears && bursar) {
    const done = await owner.ledgerEntry.count({
      where: { schoolId: bahari, studentId: brian.id, description: ARREARS_NOTE },
    });
    if (!done) {
      await postEntry(owner as unknown as Tx, {
        schoolId: bahari,
        studentId: brian.id,
        type: "charge",
        description: ARREARS_NOTE,
        createdById: bursar.id,
        lines: [{ voteHeadId: arrears.id, amountCents: 2_000_000 }],
      });
    }
  }

  // A second notice, to Brian's stream only, so Wanjiku has more than one unread.
  if (
    brian?.streamId &&
    !(await owner.messageCampaign.count({ where: { schoolId: bahari, body: NOTICE } }))
  ) {
    const director = await owner.user.findUniqueOrThrow({ where: { phone: "+254711000001" } });
    const app = createAppClient();
    setSmsDriverForTests(consoleDriver);
    setWhatsAppDriverForTests(null);
    try {
      const now = new Date(Date.now() - 60 * 60_000);
      now.setUTCHours(8, 0, 0, 0); // 11:00 Nairobi: never quiet hours
      if (now > new Date()) now.setUTCDate(now.getUTCDate() - 1);
      await sendNotice(
        { db: app },
        {
          userId: director.id,
          schoolId: bahari,
          permissions: effectivePermissions({
            rolePermissions: BUILT_IN_ROLES.find((r) => r.key === "director")!.permissions,
            grants: [],
          }),
        },
        parseNoticeInput({
          audience: `stream:${brian.streamId}`,
          topic: "general",
          channel: "sms",
          message: NOTICE,
        }),
        null,
        now,
      );
      for (let i = 0; i < 5; i++) {
        const r = await processDueMessages(app, { now: new Date(now.getTime() + 60_000) });
        if (r.sent + r.failed + r.retrying === 0) break;
      }
    } finally {
      setSmsDriverForTests(null);
      setWhatsAppDriverForTests(undefined);
      await app.$disconnect();
    }
  }
}
