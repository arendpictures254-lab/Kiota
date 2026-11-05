/**
 * Development seed for messaging (runs as the owner, idempotent per school).
 *
 *  seedWallets (before the fees seed, so its payments send real confirmations):
 *    starter credit from Arend Studio, a bank transfer credited by the Arend admin and a
 *    completed M-Pesa top-up; Bahari Academy's sender ID is approved.
 *  seedMessageHistory (after the fees seed):
 *    a notice to the whole school and fee reminders to a few defaulters, sent through the real
 *    worker, then delivery reports: all delivered except one that failed (and was refunded).
 *
 * Sending runs as the app role (kiota_app), so row-level security applies exactly as in the app.
 * Always uses the console SMS driver and no WhatsApp, whatever .env says, so seeding can never
 * send a real message.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { BUILT_IN_ROLES } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { createClient, withContext } from "../src/lib/db-core";
import { parseNoticeInput, sendFeeReminders, sendNotice } from "../src/lib/messaging/service";
import { ensureMessagingMember } from "../src/lib/messaging/system";
import { adminCreditWallet, adminSetWallet } from "../src/lib/messaging/wallet";
import { applyDeliveryReport, processDueMessages } from "../src/lib/messaging/worker";
import type { Actor } from "../src/lib/service-kit";
import { ValidationError } from "../src/lib/service-kit";
import { setSmsDriverForTests } from "../src/lib/sms";
import { consoleDriver } from "../src/lib/sms/console-driver";
import { setWhatsAppDriverForTests } from "../src/lib/whatsapp";

const ADMIN_PHONE = "+254700000001";

const perms = (key: string) =>
  effectivePermissions({
    rolePermissions: BUILT_IN_ROLES.find((r) => r.key === key)!.permissions,
    grants: [],
  });

async function userId(owner: PrismaClient, phone: string) {
  return (await owner.user.findUniqueOrThrow({ where: { phone } })).id;
}

/** The most recent 10:00 Nairobi (07:00 UTC) in the past: daytime, so nothing waits. */
function lastMorning(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7));
  if (d > now) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

type SchoolSeed = { id: string; name: string; shortName: string; directorPhone: string };

export async function seedWallets(owner: PrismaClient, schools: readonly SchoolSeed[]) {
  const admin = { userId: await userId(owner, ADMIN_PHONE), isPlatformAdmin: true };
  const deps = { db: owner };
  for (const s of schools) {
    if ((await owner.walletEntry.count({ where: { schoolId: s.id } })) > 0) continue;
    await withContext(owner, { userId: admin.userId, schoolId: s.id }, (tx) =>
      ensureMessagingMember(tx, s.id),
    );
    if (s.shortName === "BAHARI") {
      await adminSetWallet(deps, admin, s.id, {
        smsPrice: "1.00",
        whatsappPrice: "1.50",
        overdraft: "200",
        senderId: "BAHARI",
        senderIdApproved: true,
      });
    }
    await adminCreditWallet(deps, admin, s.id, {
      kind: "starter",
      amount: "500",
      note: "Welcome credit from Arend Studio",
    });
    await adminCreditWallet(deps, admin, s.id, {
      kind: "manual",
      amount: "2000",
      reference: `EQ${s.shortName}0412`,
      note: "Bank transfer",
    });
    // A completed M-Pesa top-up, as if the Director paid Arend Studio's Paybill by STK Push.
    const director = await userId(owner, s.directorPhone);
    const topup = await owner.walletTopup.create({
      data: {
        schoolId: s.id,
        method: "mpesa",
        amountCents: 100_000,
        status: "completed",
        phone: s.directorPhone,
        checkoutRequestId: `ws_CO_seed_${s.shortName}`,
        transId: `SLSEED${s.shortName.slice(0, 4)}`,
        requestedById: director,
        completedAt: new Date(),
      },
    });
    await owner.walletEntry.create({
      data: {
        schoolId: s.id,
        type: "topup",
        amountCents: topup.amountCents,
        description: `M-Pesa top-up ${topup.transId}`,
        topupId: topup.id,
        createdById: director,
      },
    });
  }
}

export async function seedMessageHistory(
  owner: PrismaClient,
  schools: readonly (SchoolSeed & { bursarPhone: string })[],
) {
  const app = createClient(process.env.APP_DATABASE_URL);
  setSmsDriverForTests(consoleDriver);
  setWhatsAppDriverForTests(null);
  try {
    const deps = { db: app };
    const morning = lastMorning();
    const at = (min: number) => new Date(morning.getTime() + min * 60_000);
    for (const s of schools) {
      if ((await owner.messageCampaign.count({ where: { schoolId: s.id } })) > 0) continue;
      const director: Actor = {
        userId: await userId(owner, s.directorPhone),
        schoolId: s.id,
        permissions: perms("director"),
      };
      const bursar: Actor = {
        userId: await userId(owner, s.bursarPhone),
        schoolId: s.id,
        permissions: perms("bursar"),
      };
      const skipEmpty = (err: unknown) => {
        if (!(err instanceof ValidationError)) throw err; // e.g. nobody to send to yet
      };

      await sendNotice(
        deps,
        director,
        parseNoticeInput({
          audience: "school",
          topic: "general",
          channel: "sms",
          message: `${s.name}: Term 1 opens on Monday 4 January 2027 at 8am. Boarders report on Sunday by 4pm.`,
          messageSw: `${s.name}: Muhula wa kwanza unaanza Jumatatu 4 Januari 2027 saa mbili asubuhi. Wanafunzi wa bweni wafike Jumapili kabla ya saa kumi jioni.`,
        }),
        null,
        at(0),
      ).catch(skipEmpty);

      const owing = await owner.$queryRaw<{ student_id: string }[]>`
        SELECT student_id FROM ledger_lines WHERE school_id = ${s.id}::uuid
        GROUP BY student_id HAVING sum(amount_cents) > 0 ORDER BY student_id LIMIT 3`;
      if (owing.length) {
        await sendFeeReminders(
          deps,
          bursar,
          owing.map((o) => o.student_id),
          null,
          at(5),
        ).catch(skipEmpty);
      }
    }

    // The worker takes a batch per school per run: run until nothing is left to send.
    for (let i = 0; i < 20; i++) {
      const r = await processDueMessages(app, { now: at(10) });
      if (r.sent + r.retrying + r.failed === 0) break;
    }

    // Delivery reports: everything delivered, except one that never reached the phone.
    for (const s of schools) {
      const sent = await owner.message.findMany({
        where: { schoolId: s.id, status: "sent", provider: "console", campaignId: { not: null } },
        orderBy: { createdAt: "asc" },
      });
      for (const [i, m] of sent.entries()) {
        const failed = i === sent.length - 1 && sent.length > 1;
        await applyDeliveryReport(
          app,
          {
            provider: "console",
            providerMessageId: m.providerMessageId!,
            outcome: failed ? "failed" : "delivered",
            error: failed ? "AbsentSubscriber: the phone was off" : null,
          },
          at(15),
        );
      }
    }
  } finally {
    setSmsDriverForTests(null);
    setWhatsAppDriverForTests(undefined);
    await app.$disconnect();
  }
}
