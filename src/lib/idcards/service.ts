/**
 * Student ID cards (idcards.print: Director, Principal, School secretary). Printing a class or
 * stream issues a card to every student who has none; a lost card is reissued (the old card is
 * revoked, so its QR code stops working at once). The gate reads a card through the narrow
 * app_gate_card() function: a guard never reads student records.
 */
import { randomBytes } from "node:crypto";
import { audit } from "@/lib/audit";
import { ForbiddenError, assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { schoolCrest } from "@/lib/fees/receipts";
import { type GatePass, gatePassesForStudent } from "@/lib/leaveout/gate";
import { signCard } from "@/lib/leaveout/keys";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { settingsIn } from "@/lib/settings/service";
import { getStorage } from "@/lib/storage";
import { parseCard } from "./card-token";

export const canPrintCards = (p: Actor["permissions"]) => p.has("idcards.print");

const nonce = () => randomBytes(9).toString("base64url");

/** Cards are valid to the end of the current (or next) academic year. */
async function validUntil(tx: Tx, schoolId: string, now: Date) {
  const year = await tx.academicYear.findFirst({
    where: { schoolId, endDate: { gte: now } },
    orderBy: { startDate: "asc" },
    select: { endDate: true },
  });
  return (year?.endDate ?? now).getUTCFullYear();
}

export type CardAudience = {
  streamId?: string | null;
  classId?: string | null;
  studentIds?: string[];
};

async function audienceStudents(tx: Tx, schoolId: string, a: CardAudience) {
  if (!a.streamId && !a.classId && !a.studentIds?.length)
    throw new ValidationError("Choose a class or stream.");
  return tx.student.findMany({
    where: {
      schoolId,
      status: "active",
      ...(a.studentIds?.length ? { id: { in: a.studentIds } } : {}),
      ...(a.streamId ? { streamId: a.streamId } : {}),
      ...(a.classId ? { classId: a.classId } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNumber: true,
      boarder: true,
      photoKey: true,
      class: { select: { name: true } },
      stream: { select: { name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

export type PrintCard = {
  cardId: string;
  studentId: string;
  name: string;
  admissionNumber: string;
  classLabel: string;
  boarder: boolean;
  validUntilYear: number;
  token: string;
  photo: { bytes: Buffer; contentType: string } | null;
};

/**
 * Everything needed to print cards for a class, stream or list of students. Students without a
 * live card are issued one (in the same transaction, audited).
 */
export async function cardsForPrint(
  { db }: Deps,
  actor: Actor,
  audience: CardAudience,
  now = new Date(),
) {
  assertCan(actor.permissions, "idcards.print");
  const data = await withContext(db, ctxOf(actor), async (tx) => {
    const students = await audienceStudents(tx, actor.schoolId, audience);
    const live = await tx.studentCard.findMany({
      where: {
        schoolId: actor.schoolId,
        studentId: { in: students.map((s) => s.id) },
        revokedAt: null,
      },
    });
    const missing = students.filter((s) => !live.some((c) => c.studentId === s.id));
    if (missing.length) {
      const until = await validUntil(tx, actor.schoolId, now);
      await tx.studentCard.createMany({
        data: missing.map((s) => ({
          schoolId: actor.schoolId,
          studentId: s.id,
          nonce: nonce(),
          validUntilYear: until,
          issuedById: actor.userId,
        })),
      });
      await audit(tx, {
        schoolId: actor.schoolId,
        actorId: actor.userId,
        action: "idcard.issue",
        targetType: "student_card",
        targetId: missing.length === 1 ? missing[0].id : "batch",
        after: { students: missing.length },
        ip: actor.ip,
      });
    }
    const cards = await tx.studentCard.findMany({
      where: {
        schoolId: actor.schoolId,
        studentId: { in: students.map((s) => s.id) },
        revokedAt: null,
      },
    });
    const school = await tx.school.findUniqueOrThrow({
      where: { id: actor.schoolId },
      select: { id: true, name: true, logoUrl: true },
    });
    const settings = await settingsIn(tx, actor.schoolId);
    const list = [];
    for (const s of students) {
      const c = cards.find((x) => x.studentId === s.id)!;
      list.push({ s, c, token: await signCard(tx, actor.schoolId, c.id, c.nonce) });
    }
    return { list, school, settings };
  });
  const storage = getStorage();
  const cards: PrintCard[] = await Promise.all(
    data.list.map(async ({ s, c, token }) => ({
      cardId: c.id,
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNumber: s.admissionNumber,
      classLabel: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
      boarder: s.boarder,
      validUntilYear: c.validUntilYear,
      token,
      photo: s.photoKey ? await storage.get(s.photoKey).catch(() => null) : null,
    })),
  );
  return {
    school: {
      name: data.school.name,
      crest: await schoolCrest(data.school.logoUrl, data.school.id),
      phone: data.settings.cardPhone ?? null,
      email: data.settings.cardEmail ?? null,
      address: data.settings.cardAddress ?? null,
    },
    cards,
  };
}

/** A lost or damaged card: revoke it and issue a new one (a new QR code). */
export async function reissueCard(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  rawReason: unknown,
  now = new Date(),
) {
  assertCan(actor.permissions, "idcards.print");
  const reason = clean(rawReason)?.slice(0, 200) ?? "Lost";
  return withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findFirst({
      where: { schoolId: actor.schoolId, id: studentId, status: "active" },
      select: { id: true },
    });
    if (!student) throw new ValidationError("Student not found.");
    const old = await tx.studentCard.findFirst({
      where: { schoolId: actor.schoolId, studentId, revokedAt: null },
    });
    if (old)
      await tx.studentCard.update({
        where: { schoolId: actor.schoolId, id: old.id },
        data: { revokedAt: now, revokedById: actor.userId, revokeReason: reason },
      });
    const card = await tx.studentCard.create({
      data: {
        schoolId: actor.schoolId,
        studentId,
        nonce: nonce(),
        validUntilYear: await validUntil(tx, actor.schoolId, now),
        issuedById: actor.userId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "idcard.reissue",
      targetType: "student_card",
      targetId: card.id,
      before: old ? { cardId: old.id } : undefined,
      after: { cardId: card.id, reason },
      ip: actor.ip,
    });
    return card;
  });
}

/** A student's cards (newest first) for the profile. */
export async function studentCards({ db }: Deps, actor: Actor, studentId: string) {
  return withContext(db, ctxOf(actor), (tx) =>
    tx.studentCard.findMany({
      where: { schoolId: actor.schoolId, studentId },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        issuedAt: true,
        revokedAt: true,
        revokeReason: true,
        validUntilYear: true,
      },
    }),
  );
}

/** The card details on the back of the card (Director). */
export async function updateCardContacts({ db }: Deps, actor: Actor, raw: Record<string, unknown>) {
  if (!actor.permissions.has("school.settings.manage") && !canPrintCards(actor.permissions))
    throw new ForbiddenError("idcards.print");
  const data = {
    cardPhone: clean(raw.phone)?.slice(0, 40) ?? null,
    cardEmail: clean(raw.email)?.slice(0, 80) ?? null,
    cardAddress: clean(raw.address)?.slice(0, 120) ?? null,
  };
  await withContext(db, ctxOf(actor), async (tx) => {
    await tx.schoolSettings.update({ where: { schoolId: actor.schoolId }, data });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "settings.idcards",
      targetType: "school",
      targetId: actor.schoolId,
      after: data,
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------
// The gate: a student's ID card scanned instead of a pass
// ---------------------------------------------------------------------------

export type GateCardResult =
  | { found: false; reason: "not_a_card" | "other_school" | "unknown" }
  | {
      found: true;
      live: boolean;
      student: {
        name: string;
        admissionNumber: string;
        classLabel: string;
        boarder: boolean;
        photo: string | null;
      };
      validUntilYear: number;
      /** An approved (or out) leave-out: the gate then checks it like a pass. */
      pass: GatePass | null;
    };

export async function gateCard({ db }: Deps, actor: Actor, token: string): Promise<GateCardResult> {
  if (!actor.permissions.has("gate.scan") && !actor.permissions.has("boarding.manage"))
    throw new ForbiddenError("gate.scan");
  const c = parseCard(token);
  if (!c) return { found: false, reason: "not_a_card" };
  if (c.schoolId !== actor.schoolId) return { found: false, reason: "other_school" };
  const row = await withContext(db, ctxOf(actor), async (tx) => {
    const [r] = await tx.$queryRaw<
      {
        card_id: string;
        live: boolean;
        valid_until_year: number;
        student_id: string;
        first_name: string;
        last_name: string;
        admission_number: string;
        class_label: string;
        boarder: boolean;
        photo_key: string | null;
      }[]
    >`SELECT * FROM app_gate_card(${c.cardId}::uuid, ${c.nonce})`;
    return r ?? null;
  });
  if (!row) return { found: false, reason: "unknown" };
  const photoFile = row.photo_key
    ? await getStorage()
        .get(row.photo_key)
        .catch(() => null)
    : null;
  const passes = row.live ? await gatePassesForStudent({ db }, actor, row.student_id) : [];
  return {
    found: true,
    live: row.live,
    validUntilYear: row.valid_until_year,
    student: {
      name: `${row.first_name} ${row.last_name}`,
      admissionNumber: row.admission_number,
      classLabel: row.class_label,
      boarder: row.boarder,
      photo: photoFile
        ? `data:${photoFile.contentType};base64,${photoFile.bytes.toString("base64")}`
        : null,
    },
    pass: passes[0] ?? null,
  };
}

/**
 * What the print preview shows, without issuing anything: each student with their live card's
 * token (or none yet: printing will issue one).
 */
export async function previewCards({ db }: Deps, actor: Actor, audience: CardAudience) {
  assertCan(actor.permissions, "idcards.print");
  return withContext(db, ctxOf(actor), async (tx) => {
    const students = await audienceStudents(tx, actor.schoolId, audience);
    const live = await tx.studentCard.findMany({
      where: {
        schoolId: actor.schoolId,
        studentId: { in: students.map((s) => s.id) },
        revokedAt: null,
      },
    });
    const school = await tx.school.findUniqueOrThrow({
      where: { id: actor.schoolId },
      select: { name: true, logoUrl: true },
    });
    const settings = await settingsIn(tx, actor.schoolId);
    const until = await validUntil(tx, actor.schoolId, new Date());
    const cards = [];
    for (const s of students) {
      const c = live.find((x) => x.studentId === s.id);
      cards.push({
        studentId: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNumber: s.admissionNumber,
        classLabel: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
        boarder: s.boarder,
        hasPhoto: !!s.photoKey,
        validUntilYear: c?.validUntilYear ?? until,
        token: c ? await signCard(tx, actor.schoolId, c.id, c.nonce) : null,
      });
    }
    return {
      school: {
        name: school.name,
        hasCrest: !!school.logoUrl,
        phone: settings.cardPhone,
        email: settings.cardEmail,
        address: settings.cardAddress,
      },
      cards,
    };
  });
}
