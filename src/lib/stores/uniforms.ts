/**
 * Uniforms: issued to a named student from a uniform store, one size per item with a price.
 * Each issue is charged to the student's fee account through the fees module (postCharge: an
 * append-only charge on the Uniform vote head), or marked paid separately with a reference.
 * A return or an exchange brings the stock back and reverses the charge (reverseCharge), never
 * editing it. The screen shows what the student already has, and a second issue of the same
 * item needs a deliberate "issue again".
 */
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { type Tx, withContext } from "@/lib/db-core";
import { postCharge, reverseCharge } from "@/lib/fees/invoicing";
import { type Actor, type Deps, ValidationError, clean, ctxOf } from "@/lib/service-kit";
import { nairobiDate } from "@/lib/attendance/rules";
import { assertSeeStores, lockItem, putIn, takeOut } from "./service";

export async function findStudentForUniform({ db }: Deps, actor: Actor, admissionNumber: unknown) {
  assertCan(actor.permissions, "stores.issue");
  const adm = clean(admissionNumber);
  if (!adm) return null;
  return withContext(db, ctxOf(actor), (tx) =>
    tx.student.findFirst({
      where: { schoolId: actor.schoolId, admissionNumber: adm, status: "active" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        class: { select: { name: true } },
        stream: { select: { name: true } },
      },
    }),
  );
}

/** Everything a student has been issued (newest first), with item names. */
export async function studentUniforms({ db }: Deps, actor: Actor, studentId: string) {
  assertSeeStores(actor.permissions);
  return withContext(db, ctxOf(actor), (tx) => uniformsOf(tx, actor.schoolId, studentId));
}

async function uniformsOf(tx: Tx, schoolId: string, studentId: string) {
  const issues = await tx.uniformIssue.findMany({
    where: { schoolId, studentId },
    orderBy: { issuedAt: "desc" },
  });
  const items = await tx.storeItem.findMany({
    where: { schoolId, id: { in: issues.map((i) => i.itemId) } },
    select: { id: true, name: true, size: true },
  });
  return issues.map((i) => ({ ...i, item: items.find((x) => x.id === i.itemId)! }));
}

async function uniformVoteHead(tx: Tx, schoolId: string) {
  const s = await tx.schoolSettings.findUnique({ where: { schoolId } });
  const vh = s?.uniformVoteHeadId
    ? await tx.voteHead.findFirst({ where: { schoolId, id: s.uniformVoteHeadId } })
    : await tx.voteHead.findFirst({
        where: { schoolId, name: { contains: "Uniform", mode: "insensitive" } },
      });
  if (!vh)
    throw new ValidationError(
      "Set the vote head uniforms are charged to (Stores → Settings), or add a Uniform vote head in Fee setup.",
    );
  return vh;
}

export type IssueUniformInput = {
  studentId: string;
  itemId: string;
  quantity: unknown;
  payment: unknown;
  reference?: unknown;
  /** The student already has this item: issue again anyway. */
  again?: boolean;
};

export type IssueUniformResult =
  | { status: "issued"; issueId: string; totalCents: number; charged: boolean }
  | {
      status: "already_has";
      existing: { name: string; size: string; issuedAt: Date; quantity: number }[];
    };

export async function issueUniform(
  { db }: Deps,
  actor: Actor,
  input: IssueUniformInput,
  now = new Date(),
): Promise<IssueUniformResult> {
  assertCan(actor.permissions, "stores.issue");
  const quantity = Number(clean(input.quantity) ?? 1);
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20)
    throw new ValidationError("Enter how many pieces.", "quantity");
  const payment = input.payment === "paid_separately" ? "paid_separately" : "charged";
  const reference = clean(input.reference)?.slice(0, 60) ?? null;
  if (payment === "paid_separately" && !reference)
    throw new ValidationError("Enter the receipt or M-Pesa reference.", "reference");
  return withContext(db, ctxOf(actor), (tx) =>
    issueUniformIn(tx, actor, { ...input, quantity, payment, reference }, now),
  );
}

async function issueUniformIn(
  tx: Tx,
  actor: Actor,
  input: {
    studentId: string;
    itemId: string;
    quantity: number;
    payment: "charged" | "paid_separately";
    reference: string | null;
    again?: boolean;
  },
  now: Date,
): Promise<IssueUniformResult> {
  const { quantity, payment, reference } = input;
  {
    const student = await tx.student.findFirst({
      where: { schoolId: actor.schoolId, id: input.studentId, status: "active" },
    });
    if (!student) throw new ValidationError("Student not found.");
    const item = await tx.storeItem.findFirst({
      where: { schoolId: actor.schoolId, id: input.itemId, active: true },
      include: { store: true },
    });
    if (!item || item.store.kind !== "uniform")
      throw new ValidationError("Choose a uniform item.", "itemId");
    if (item.priceCents === null)
      throw new ValidationError(`${item.name} has no price yet.`, "itemId");

    // Double issue: the same garment (any size) already given and not returned.
    const existing = await tx.uniformIssue.findMany({
      where: { schoolId: actor.schoolId, studentId: student.id, status: "issued" },
    });
    const sameGarment = await tx.storeItem.findMany({
      where: { schoolId: actor.schoolId, storeId: item.storeId, name: item.name },
      select: { id: true, name: true, size: true },
    });
    const already = existing.filter((e) => sameGarment.some((g) => g.id === e.itemId));
    if (already.length && !input.again)
      return {
        status: "already_has",
        existing: already.map((e) => {
          const g = sameGarment.find((x) => x.id === e.itemId)!;
          return { name: g.name, size: g.size, issuedAt: e.issuedAt, quantity: e.quantity };
        }),
      };

    const issueId = crypto.randomUUID();
    const total = item.priceCents * quantity;
    await takeOut(
      tx,
      {
        schoolId: actor.schoolId,
        storeId: item.storeId,
        itemId: item.id,
        kind: "uniform_issue",
        quantityMilli: quantity * 1000,
        occurredOn: nairobiDate(now),
        uniformIssueId: issueId,
        issuedTo: `${student.firstName} ${student.lastName} (${student.admissionNumber})`,
        createdById: actor.userId,
      },
      item,
    );
    let ledgerEntryId: string | null = null;
    if (payment === "charged" && total > 0) {
      const vh = await uniformVoteHead(tx, actor.schoolId);
      const entry = await postCharge(tx, actor, {
        studentId: student.id,
        voteHeadId: vh.id,
        voteHeadName: vh.name,
        amountCents: total,
        description: `Uniform: ${item.name}${item.size ? ` (${item.size})` : ""}${quantity > 1 ? ` x${quantity}` : ""}`,
      });
      ledgerEntryId = entry.id;
    }
    await tx.uniformIssue.create({
      data: {
        id: issueId,
        schoolId: actor.schoolId,
        studentId: student.id,
        itemId: item.id,
        quantity,
        unitPriceCents: item.priceCents,
        totalCents: total,
        payment,
        paidReference: reference,
        ledgerEntryId,
        issuedById: actor.userId,
        issuedAt: now,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "stores.uniform_issue",
      targetType: "student",
      targetId: student.id,
      after: {
        item: item.name,
        size: item.size,
        quantity,
        totalCents: total,
        payment,
        reference,
        again: !!input.again,
      },
      ip: actor.ip,
    });
    return { status: "issued", issueId, totalCents: total, charged: !!ledgerEntryId };
  }
}

/**
 * A return (or, with exchangeItemId, an exchange for another size): the stock comes back at the
 * value it left with, and the fee charge is reversed through the fees module. An exchange is a
 * new issue (and a new charge) of the other size.
 */
export async function returnUniform(
  deps: Deps,
  actor: Actor,
  input: { issueId: string; reason: unknown; exchangeItemId?: string | null },
  now = new Date(),
) {
  assertCan(actor.permissions, "stores.issue");
  const reason = clean(input.reason);
  if (!reason || reason.length < 3) throw new ValidationError("Say why it came back.", "reason");
  return withContext(deps.db, ctxOf(actor), async (tx) => {
    const issue = await tx.uniformIssue.findFirst({
      where: { schoolId: actor.schoolId, id: input.issueId },
    });
    if (!issue) throw new ValidationError("Issue not found.");
    if (issue.status !== "issued") throw new ValidationError("This has already been returned.");
    const item = await tx.storeItem.findFirstOrThrow({
      where: { schoolId: actor.schoolId, id: issue.itemId },
    });
    const out = await tx.stockMovement.findFirst({
      where: { schoolId: actor.schoolId, uniformIssueId: issue.id, kind: "uniform_issue" },
    });
    await lockItem(tx, item.id);
    await putIn(tx, {
      schoolId: actor.schoolId,
      storeId: item.storeId,
      itemId: item.id,
      kind: "uniform_return",
      quantityMilli: issue.quantity * 1000,
      valueCents: out ? -out.valueCents : 0,
      occurredOn: nairobiDate(now),
      uniformIssueId: issue.id,
      reason: reason.slice(0, 300),
      createdById: actor.userId,
    });
    let reversalEntryId: string | null = null;
    if (issue.ledgerEntryId) {
      const rev = await reverseCharge(
        tx,
        actor,
        issue.ledgerEntryId,
        `uniform returned (${reason})`,
      );
      reversalEntryId = rev.id;
    }
    await tx.uniformIssue.update({
      where: { schoolId: actor.schoolId, id: issue.id },
      data: {
        status: "returned",
        returnedAt: now,
        returnedById: actor.userId,
        returnReason: reason.slice(0, 300),
        reversalEntryId,
      },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: input.exchangeItemId ? "stores.uniform_exchange" : "stores.uniform_return",
      targetType: "student",
      targetId: issue.studentId,
      after: { issueId: issue.id, item: item.name, size: item.size, reason, reversalEntryId },
      ip: actor.ip,
    });
    if (!input.exchangeItemId) return { returned: issue.id, newIssue: null };
    // An exchange: the other size, charged (or paid) the same way, in the same transaction, so
    // no stock in that size means nothing changes at all.
    const next = await issueUniformIn(
      tx,
      actor,
      {
        studentId: issue.studentId,
        itemId: input.exchangeItemId,
        quantity: issue.quantity,
        payment: issue.payment === "paid_separately" ? "paid_separately" : "charged",
        reference: issue.paidReference,
        again: true,
      },
      now,
    );
    if (next.status !== "issued") throw new ValidationError("The exchange could not be issued.");
    await tx.uniformIssue.update({
      where: { schoolId: actor.schoolId, id: issue.id },
      data: { replacedById: next.issueId },
    });
    return { returned: issue.id, newIssue: next.issueId };
  });
}
