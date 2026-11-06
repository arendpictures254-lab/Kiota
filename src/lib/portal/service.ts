/**
 * The parent portal. A parent is a platform user with no membership in any school, so there is
 * no school context here: every read goes through the app_parent_* / app_my_children database
 * functions, which start from the caller's own guardian link (the only way a parent reaches
 * school data). Combined views (all children, all schools) are built here, for the parent only.
 *
 * Payments: the parent starts an M-Pesa prompt for a child they can see fees for; it runs as
 * that school's hidden automatic-payments member, to that school's Paybill, with the child's
 * admission number as the account. The parent follows only prompts they started.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { scopedDb, withContext } from "@/lib/db-core";
import { dueByDate, firstMissedDueDate } from "@/lib/fees/allocation";
import { MAX_STK_SHILLINGS, sendStkPush, systemActor } from "@/lib/mpesa/service";
import { ValidationError } from "@/lib/service-kit";

type Deps = { db: PrismaClient };
const ctx = (userId: string) => ({ userId, schoolId: null });

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

export type ChildLink = {
  linkId: string;
  /** Waiting for the parent to confirm (a second school): only school and first name are known. */
  pending: boolean;
  schoolId: string | null;
  schoolName: string;
  modules: string[];
  studentId: string | null;
  firstName: string;
  lastName: string | null;
  admissionNumber: string | null;
  className: string | null;
  streamName: string | null;
  hasPhoto: boolean;
  relationship: string;
  receivesFees: boolean;
  receivesAcademics: boolean;
  receivesBoarding: boolean;
};

type ChildRow = {
  link_id: string;
  pending: boolean;
  school_id: string | null;
  school_name: string;
  school_modules: string[];
  student_id: string | null;
  first_name: string;
  last_name: string | null;
  admission_number: string | null;
  class_name: string | null;
  stream_name: string | null;
  has_photo: boolean;
  relationship: string;
  receives_fees: boolean;
  receives_academics: boolean;
  receives_boarding: boolean;
};

export async function myChildren({ db }: Deps, userId: string): Promise<ChildLink[]> {
  const rows = await scopedDb(db, ctx(userId)).$queryRaw<ChildRow[]>`
    SELECT * FROM app_my_children()`;
  return rows.map((r) => ({
    linkId: r.link_id,
    pending: r.pending,
    schoolId: r.school_id,
    schoolName: r.school_name,
    modules: r.school_modules ?? [],
    studentId: r.student_id,
    firstName: r.first_name,
    lastName: r.last_name,
    admissionNumber: r.admission_number,
    className: r.class_name,
    streamName: r.stream_name,
    hasPhoto: r.has_photo,
    relationship: r.relationship,
    receivesFees: r.receives_fees,
    receivesAcademics: r.receives_academics,
    receivesBoarding: r.receives_boarding,
  }));
}

/** A live child of this parent (not pending), or null. */
export async function myChild(deps: Deps, userId: string, linkId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) return null;
  const child = (await myChildren(deps, userId)).find((c) => c.linkId === linkId);
  return child && !child.pending ? child : null;
}

/**
 * What this guardian may see for this child: the school's per-guardian settings (a sponsor with
 * fees only sees fees), and modules the school has switched on (built later).
 */
export function sections(
  c: Pick<ChildLink, "receivesFees" | "receivesAcademics" | "receivesBoarding" | "modules">,
) {
  return {
    fees: c.receivesFees,
    notices: c.receivesAcademics || c.receivesBoarding,
    reportCards: c.receivesAcademics && c.modules.includes("academics"),
    leaveOuts: c.receivesBoarding && c.modules.includes("boarding"),
    pocketMoney: c.receivesBoarding && c.modules.includes("pocket_money"),
  };
}

export function childLabel(c: Pick<ChildLink, "className" | "streamName">) {
  return [c.className, c.streamName].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/**
 * Split what a child owes into what is due now (overdue plus anything due today), the rest of
 * the year (instalments not due yet) and arrears (unpaid balances from previous terms). Payments
 * clear the oldest debts first, so what is still owed sits on the newest invoice first; anything
 * beyond that invoice is arrears. Pure, for tests.
 */
export function splitBalance(
  balanceCents: number,
  newest: { totalCents: number; installments: { dueDate: Date; percentBp: number }[] } | null,
  now: Date,
) {
  const owed = Math.max(0, balanceCents);
  const notYetDue = newest
    ? Math.min(newest.totalCents - dueByDate(newest.totalCents, newest.installments, now), owed)
    : 0;
  const dueNowCents = owed - notYetDue;
  const arrearsCents = Math.min(
    dueNowCents,
    newest ? Math.max(0, balanceCents - newest.totalCents) : owed,
  );
  const next = newest?.installments
    .filter((i) => i.dueDate > now)
    .sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime())[0];
  const nextDue =
    next && newest && notYetDue > 0
      ? {
          date: next.dueDate,
          amountCents: Math.min(
            notYetDue,
            dueByDate(newest.totalCents, newest.installments, next.dueDate) -
              dueByDate(newest.totalCents, newest.installments, now),
          ),
        }
      : null;
  return { dueNowCents, restOfYearCents: notYetDue, arrearsCents, nextDue };
}

type FeesJson = {
  balanceCents: number;
  voteHeads: { name: string | null; balanceCents: number }[];
  invoices: {
    id: string;
    term: string;
    year: string;
    totalCents: number;
    createdAt: string;
    installments: { dueDate: string; percentBp: number }[];
  }[];
  payments: {
    id: string;
    amountCents: number;
    method: string;
    reference: string | null;
    paidAt: string;
    receiptNumber: number | null;
    shareToken: string | null;
    reversed: boolean;
  }[];
  mpesa: boolean;
};

export type ChildFees = Awaited<ReturnType<typeof childFees>>;

/** A child's fees, or null when this guardian may not see them. */
export async function childFees({ db }: Deps, userId: string, linkId: string, now = new Date()) {
  const [row] = await scopedDb(db, ctx(userId)).$queryRaw<{ f: FeesJson | null }[]>`
    SELECT app_parent_fees(${linkId}::uuid) AS f`;
  const f = row?.f;
  if (!f) return null;
  const balance = Number(f.balanceCents);
  const invoices = f.invoices.map((i, index) => {
    const plan = i.installments.map((p) => ({
      dueDate: new Date(p.dueDate),
      percentBp: p.percentBp,
    }));
    // The newest invoice carries what is still owed (older balances are cleared first).
    const paidToward =
      index === 0 ? i.totalCents - Math.min(Math.max(balance, 0), i.totalCents) : i.totalCents;
    const missed = firstMissedDueDate(i.totalCents, paidToward, plan, now);
    return {
      id: i.id,
      term: i.term,
      year: i.year,
      totalCents: i.totalCents,
      installments: plan.map((p) => ({
        ...p,
        overdue: !!missed && p.dueDate <= now && p.dueDate.getTime() >= missed.getTime(),
      })),
      overdueSince: missed,
    };
  });
  const split = splitBalance(balance, invoices[0] ?? null, now);
  return {
    balanceCents: balance,
    voteHeads: f.voteHeads.map((v) => ({ name: v.name, balanceCents: Number(v.balanceCents) })),
    invoices,
    ...split,
    /** The first instalment date missed, if part of "due now" is a missed instalment. */
    missedSince:
      split.dueNowCents > split.arrearsCents ? (invoices[0]?.overdueSince ?? null) : null,
    payments: f.payments.map((p) => ({ ...p, paidAt: new Date(p.paidAt) })),
    mpesa: f.mpesa,
  };
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export async function childNotices({ db }: Deps, userId: string, linkId: string) {
  const rows = await scopedDb(db, ctx(userId)).$queryRaw<
    {
      campaign_id: string;
      body: string | null;
      critical: boolean;
      created_at: Date;
      read_at: Date | null;
    }[]
  >`SELECT * FROM app_parent_notices(${linkId}::uuid)`;
  return rows.map((r) => ({
    id: r.campaign_id,
    body: r.body ?? "",
    critical: r.critical,
    sentAt: r.created_at,
    readAt: r.read_at,
  }));
}

export async function markNoticeRead({ db }: Deps, userId: string, campaignId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return false;
  const [row] = await withContext(
    db,
    ctx(userId),
    (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_parent_mark_read(${campaignId}::uuid) AS ok`,
  );
  return row?.ok === true;
}

// ---------------------------------------------------------------------------
// All children (the family home)
// ---------------------------------------------------------------------------

export type Attention =
  | { kind: "pending"; linkId: string; child: string; school: string }
  | { kind: "due"; linkId: string; child: string; amountCents: number; arrearsCents: number }
  | { kind: "unread"; linkId: string; child: string; count: number };

export async function familyOverview(deps: Deps, userId: string, now = new Date()) {
  const children = await myChildren(deps, userId);
  const live = children.filter((c) => !c.pending);
  const perChild = await Promise.all(
    live.map(async (c) => {
      const s = sections(c);
      const [fees, notices] = await Promise.all([
        s.fees ? childFees(deps, userId, c.linkId, now) : null,
        s.notices ? childNotices(deps, userId, c.linkId) : [],
      ]);
      return { child: c, fees, unread: notices.filter((n) => !n.readAt).length };
    }),
  );
  const attention: Attention[] = [
    ...children
      .filter((c) => c.pending)
      .map((c) => ({
        kind: "pending" as const,
        linkId: c.linkId,
        child: c.firstName,
        school: c.schoolName,
      })),
    ...perChild.flatMap(({ child, fees }) =>
      fees && fees.dueNowCents > 0
        ? [
            {
              kind: "due" as const,
              linkId: child.linkId,
              child: child.firstName,
              amountCents: fees.dueNowCents,
              arrearsCents: fees.arrearsCents,
            },
          ]
        : [],
    ),
    ...perChild.flatMap(({ child, unread }) =>
      unread > 0
        ? [{ kind: "unread" as const, linkId: child.linkId, child: child.firstName, count: unread }]
        : [],
    ),
  ];
  const withFees = perChild.filter((p) => p.fees);
  return {
    children,
    perChild,
    /** Only children whose fees this parent may see. */
    totalBalanceCents: withFees.reduce((n, p) => n + (p.fees?.balanceCents ?? 0), 0),
    showsFees: withFees.length > 0,
    attention,
  };
}

// ---------------------------------------------------------------------------
// A link from a second school: confirm with a fresh SMS code, or decline
// ---------------------------------------------------------------------------

type Otp = {
  requestCode(phone: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  verifyCode(
    phone: string,
    code: string,
  ): Promise<{ ok: true; userId: string } | { ok: false; reason: string; attemptsLeft?: number }>;
};

async function pendingLink(deps: Deps, userId: string, linkId: string) {
  const c = (await myChildren(deps, userId)).find((x) => x.linkId === linkId);
  return c?.pending ? c : null;
}

export class PortalCodeError extends ValidationError {
  constructor(
    public readonly reason: string,
    public readonly attemptsLeft?: number,
  ) {
    super(reason, "code");
    this.name = "PortalCodeError";
  }
}

/** Send a fresh code to the parent's own phone before they may confirm. */
export async function requestConfirmCode(
  deps: Deps,
  otp: Otp,
  user: { id: string; phone: string },
  linkId: string,
) {
  if (!(await pendingLink(deps, user.id, linkId))) throw new ValidationError("gone");
  const r = await otp.requestCode(user.phone);
  if (!r.ok) throw new PortalCodeError(r.reason);
}

/** Confirm with the fresh code: the child then appears in the parent's account. */
export async function confirmLink(
  deps: Deps,
  otp: Otp,
  user: { id: string; phone: string },
  linkId: string,
  code: string,
) {
  if (!(await pendingLink(deps, user.id, linkId))) throw new ValidationError("gone");
  const v = await otp.verifyCode(user.phone, code.replace(/\D/g, ""));
  if (!v.ok) throw new PortalCodeError(v.reason, v.attemptsLeft);
  if (v.userId !== user.id) throw new PortalCodeError("wrong_code");
  const [row] = await withContext(
    deps.db,
    ctx(user.id),
    (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_confirm_parent_link(${linkId}::uuid) AS ok`,
  );
  if (!row?.ok) throw new ValidationError("gone");
}

/** Decline: that school's Director is told; nothing about other schools is shared. */
export async function declineLink({ db }: Deps, userId: string, linkId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw new ValidationError("gone");
  const [row] = await withContext(
    db,
    ctx(userId),
    (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT app_decline_parent_link(${linkId}::uuid) AS ok`,
  );
  if (!row?.ok) throw new ValidationError("gone");
}

/** At sign-in: each school can see that this parent has signed in. */
export async function recordParentSignIn({ db }: Deps, userId: string) {
  await withContext(db, ctx(userId), (tx) => tx.$executeRaw`SELECT app_record_parent_sign_in()`);
}

export async function setMyLanguage({ db }: Deps, userId: string, language: string) {
  if (language !== "en" && language !== "sw") throw new ValidationError("Choose a language.");
  await withContext(
    db,
    ctx(userId),
    (tx) => tx.$executeRaw`SELECT app_set_my_language(${language})`,
  );
}

// ---------------------------------------------------------------------------
// Paying by M-Pesa from the portal
// ---------------------------------------------------------------------------

export class PayInputError extends ValidationError {}

export async function startPayment(
  deps: Deps,
  user: { id: string },
  linkId: string,
  raw: { amount: unknown; phone: unknown },
) {
  const child = await myChild(deps, user.id, linkId);
  if (!child || !child.receivesFees || !child.schoolId || !child.studentId)
    throw new ValidationError("not_found");
  const amount = Number(String(raw.amount ?? "").replace(/[,\s]/g, ""));
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_STK_SHILLINGS)
    throw new PayInputError("amount", "amount");
  let actor;
  try {
    actor = await systemActor(deps.db, child.schoolId);
  } catch {
    throw new ValidationError("no_mpesa");
  }
  try {
    const r = await sendStkPush(
      deps,
      actor,
      { studentId: child.studentId, phone: raw.phone, amount: String(amount) },
      { portalUserId: user.id },
    );
    return { transactionId: r.id };
  } catch (err) {
    if (err instanceof ValidationError) {
      if (err.field === "phone") throw new PayInputError("phone", "phone");
      if (err.field === "amount") throw new PayInputError("amount", "amount");
      if (/not set up/i.test(err.message)) throw new ValidationError("no_mpesa");
    }
    throw err;
  }
}

export type PaymentStatus =
  | { state: "waiting" }
  | { state: "checking" }
  | { state: "done"; receiptNumber: number; shareToken: string; amountCents: number }
  | { state: "failed"; detail: string | null }
  | { state: "unknown" };

export async function paymentStatus(
  { db }: Deps,
  userId: string,
  transactionId: string,
): Promise<PaymentStatus> {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return { state: "unknown" };
  const [r] = await scopedDb(db, ctx(userId)).$queryRaw<
    {
      status: string;
      status_detail: string | null;
      amount_cents: number | null;
      receipt_number: number | null;
      share_token: string | null;
    }[]
  >`SELECT * FROM app_parent_stk_status(${transactionId}::uuid)`;
  if (!r) return { state: "unknown" };
  if (r.share_token && r.receipt_number !== null)
    return {
      state: "done",
      receiptNumber: r.receipt_number,
      shareToken: r.share_token,
      amountCents: r.amount_cents ?? 0,
    };
  if (r.status === "stk_requested") return { state: "waiting" };
  if (["failed", "rejected"].includes(r.status))
    return { state: "failed", detail: r.status_detail };
  return { state: "checking" };
}

// ---------------------------------------------------------------------------
// Where to go after sign-in
// ---------------------------------------------------------------------------

/**
 * Staff and parents share one sign-in. Someone who is both chooses (and can switch any time);
 * the session remembers the choice.
 */
export function homeFor(p: {
  staffSchools: number;
  isPlatformAdmin: boolean;
  hasChildren: boolean;
  mode: "staff" | "parent" | null;
}): "/choose" | "/parent" | "/dashboard" | "/schools" | "/admin" {
  const staffHome =
    p.staffSchools === 1
      ? "/dashboard"
      : p.staffSchools === 0 && p.isPlatformAdmin
        ? "/admin"
        : "/schools";
  const isStaff = p.staffSchools > 0 || p.isPlatformAdmin;
  if (p.hasChildren && isStaff) {
    if (p.mode === "parent") return "/parent";
    if (p.mode === "staff") return staffHome;
    return "/choose";
  }
  if (p.hasChildren) return "/parent";
  return staffHome;
}
