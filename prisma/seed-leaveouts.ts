/**
 * Development seed for leave-outs at Bahari Academy (idempotent: skipped once there are any).
 * Uses the real services as the app role, so the audit log, passes and SMS are exactly as in use.
 *
 *  - Mercy Chebet (0711 000 005), boarding master, granted "approve leave-outs" by the Director.
 *  - Hassan Ali (0711 000 004), gate guard: sees only the gate.
 *  - Today: one approved pass ready at the gate, one student already out, one overdue back.
 *  - Wanjiku's request (from the parent portal) for Brian, waiting for approval.
 *  - A declined request.
 * The pass students get a simple placeholder photo, so the gate shows a photo to check.
 * Pickup codes go to the collectors by (console) SMS: see .dev/sms-outbox.log.
 */
import { deflateSync } from "node:zlib";
import type { PrismaClient } from "../src/generated/prisma/client";
import { BUILT_IN_ROLES, type PermissionKey } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { createAppClient } from "../src/lib/db-core";
import { recordGateEvents } from "../src/lib/leaveout/gate";
import { parentRequestLeaveout } from "../src/lib/leaveout/parent";
import {
  approveLeaveout,
  declineLeaveout,
  parseLeaveoutInput,
  requestLeaveout,
} from "../src/lib/leaveout/service";
import { processDueMessages } from "../src/lib/messaging/worker";
import type { Actor } from "../src/lib/service-kit";
import { setSmsDriverForTests } from "../src/lib/sms";
import { consoleDriver } from "../src/lib/sms/console-driver";
import { getStorage, schoolKey } from "../src/lib/storage";
import { setWhatsAppDriverForTests } from "../src/lib/whatsapp";

export const LEAVEOUT_SEED = {
  guard: "+254711000004",
  boardingMaster: "+254711000005",
  /** Approved for today, not yet out (scan this one at the gate). */
  ready: "BA/2025/011",
  out: "BA/2025/012",
  overdue: "BA/2025/013",
  declined: "BA/2025/014",
};

/** A tiny PNG (solid colour with a lighter "face"), so the gate has a photo to show. */
function placeholderPhoto(r: number, g: number, b: number) {
  const w = 120;
  const h = 150;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const face =
        (x - 60) ** 2 / 900 + (y - 60) ** 2 / 1300 < 1 || (y > 110 && Math.abs(x - 60) < 50);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = face ? 245 : r;
      raw[o + 1] = face ? 230 : g;
      raw[o + 2] = face ? 210 : b;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** "2026-11-13T14:00" (Nairobi) for a moment `hours` from now. */
const nairobi = (hours: number) =>
  new Date(Date.now() + hours * 3600_000 + 3 * 3600_000).toISOString().slice(0, 16);

export async function seedLeaveouts(owner: PrismaClient, schoolId: string) {
  if ((await owner.leaveout.count({ where: { schoolId } })) > 0) return;
  const user = async (phone: string) => owner.user.findUniqueOrThrow({ where: { phone } });
  const actor = async (
    phone: string,
    role: string,
    grants: PermissionKey[] = [],
  ): Promise<Actor> => ({
    userId: (await user(phone)).id,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
      grants,
    }),
  });

  // The Director grants Mercy (boarding master) the right to approve leave-outs.
  const director = await user("+254711000001");
  const mercy = await user(LEAVEOUT_SEED.boardingMaster);
  const mercyMembership = await owner.membership.findFirstOrThrow({
    where: { schoolId, userId: mercy.id },
  });
  await owner.permissionGrant.upsert({
    where: {
      membershipId_permissionKey: {
        membershipId: mercyMembership.id,
        permissionKey: "leaveout.approve",
      },
    },
    create: {
      schoolId,
      membershipId: mercyMembership.id,
      permissionKey: "leaveout.approve",
      grantedById: director.id,
    },
    update: {},
  });

  const app = createAppClient();
  setSmsDriverForTests(consoleDriver);
  setWhatsAppDriverForTests(null);
  try {
    const deps = { db: app };
    const approver = await actor(LEAVEOUT_SEED.boardingMaster, "boarding_master", [
      "leaveout.approve",
    ]);
    const guard = await actor(LEAVEOUT_SEED.guard, "gate_guard");
    const weekend = await owner.leaveoutReason.findFirstOrThrow({
      where: { schoolId, name: "Weekend" },
    });
    const medical = await owner.leaveoutReason.findFirstOrThrow({
      where: { schoolId, name: "Medical appointment" },
    });

    const student = async (admissionNumber: string, colour: [number, number, number]) => {
      const s = await owner.student.findUniqueOrThrow({
        where: { schoolId_admissionNumber: { schoolId, admissionNumber } },
        include: {
          guardians: {
            where: { authorisedToCollect: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      if (!s.photoKey) {
        const key = schoolKey(schoolId, "students", s.id, "photo-seed");
        await getStorage().put(key, placeholderPhoto(...colour), "image/png");
        await owner.student.update({ where: { id: s.id }, data: { photoKey: key } });
      }
      return s;
    };
    const request = async (
      admissionNumber: string,
      colour: [number, number, number],
      reasonId: string,
      leave: number,
      back: number,
    ) => {
      const s = await student(admissionNumber, colour);
      return requestLeaveout(
        deps,
        approver,
        parseLeaveoutInput({
          studentId: s.id,
          reasonId,
          leaveAt: nairobi(leave),
          returnAt: nairobi(back),
          collector: `link:${s.guardians[0].id}`,
        }),
      );
    };

    // 1. Approved for today: ready to scan at the gate.
    const ready = await request(LEAVEOUT_SEED.ready, [31, 95, 99], weekend.id, 0.5, 50);
    await approveLeaveout(deps, approver, ready.id);

    // 2. Already out (left an hour ago, back the day after tomorrow).
    const out = await request(LEAVEOUT_SEED.out, [122, 86, 52], medical.id, 0, 50);
    const outPass = await approveLeaveout(deps, approver, out.id);
    await recordGateEvents(deps, guard, [
      {
        id: `seed-exit-${out.id}`,
        leaveoutId: out.id,
        kind: "exit",
        at: new Date(Date.now() - 3600_000).toISOString(),
        code: outPass.pickupCode,
      },
    ]);

    // 3. Overdue: left yesterday, was due back an hour ago.
    const late = await request(LEAVEOUT_SEED.overdue, [201, 162, 122], weekend.id, 0, 50);
    const latePass = await approveLeaveout(deps, approver, late.id);
    await recordGateEvents(deps, guard, [
      {
        id: `seed-exit-${late.id}`,
        leaveoutId: late.id,
        kind: "exit",
        at: new Date().toISOString(),
        code: latePass.pickupCode,
      },
    ]);
    await owner.leaveout.update({
      where: { id: late.id },
      data: {
        leaveAt: new Date(Date.now() - 26 * 3600_000),
        exitedAt: new Date(Date.now() - 25 * 3600_000),
        returnAt: new Date(Date.now() - 3600_000),
      },
    });

    // 4. Declined.
    const declined = await request(LEAVEOUT_SEED.declined, [169, 220, 214], weekend.id, 30, 60);
    await declineLeaveout(deps, approver, declined.id, "End-of-term exams start on Monday.");

    // 5. Wanjiku asks, from the parent portal, to collect Brian on Friday afternoon.
    const wanjiku = await user("+254744000001");
    const brian = await owner.student.findUniqueOrThrow({
      where: { schoolId_admissionNumber: { schoolId, admissionNumber: "BA/2024/101" } },
    });
    const link = await owner.guardianLink.findFirstOrThrow({
      where: { schoolId, studentId: brian.id, userId: wanjiku.id },
    });
    await parentRequestLeaveout(deps, wanjiku.id, link.id, {
      reasonId: (
        await owner.leaveoutReason.findFirstOrThrow({ where: { schoolId, name: "Family event" } })
      ).id,
      details: "Cousin's wedding in Mombasa",
      leaveAt: nairobi(48),
      returnAt: nairobi(96),
      collector: `link:${link.id}`,
    });

    // The SMS (pickup codes, exit) go out through the console driver now.
    for (let i = 0; i < 5; i++) {
      const r = await processDueMessages(app);
      if (r.sent + r.failed + r.retrying === 0) break;
    }
  } finally {
    setSmsDriverForTests(null);
    setWhatsAppDriverForTests(undefined);
    await app.$disconnect();
  }
}
