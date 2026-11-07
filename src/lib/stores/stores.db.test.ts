import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILT_IN_ROLES, type PermissionKey } from "@/lib/auth/catalog";
import { ForbiddenError, effectivePermissions } from "@/lib/auth/permissions";
import { scopedDb, withContext } from "@/lib/db-core";
import type { Actor } from "@/lib/service-kit";
import {
  app,
  appUnguarded,
  makeMember,
  makeSchool,
  makeStream,
  makeStudent,
  owner,
} from "../../../tests/db-helpers";
import { confirmServed, issueMeal, mealPlan, reviewVariance, setRation } from "./meals";
import { storesWidget, ensureDailyDigest } from "./reports";
import {
  adjustStock,
  issueStock,
  itemPositions,
  receiveStock,
  saveItem,
  storeStock,
  transferStock,
} from "./service";
import {
  decideStocktake,
  saveCounts,
  startStocktake,
  stocktakeDetail,
  submitStocktake,
} from "./stocktake";
import { issueUniform, returnUniform, studentUniforms } from "./uniforms";

const deps = { db: app };

function actorFor(schoolId: string, userId: string, role: string): Actor {
  return {
    userId,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions as PermissionKey[],
      grants: [],
    }),
  };
}

async function makeFixture(label: string) {
  const school = await makeSchool(`${label} ${Date.now()}`);
  const member = async (role: string) => {
    const m = await makeMember(school.id, [role], role);
    return { ...m, actor: actorFor(school.id, m.user.id, role) };
  };
  const director = await member("director");
  const principal = await member("principal");
  const storekeeper = await member("storekeeper");
  const cook = await member("cook");
  const bursar = await member("bursar");
  const stores = await owner.store.findMany({ where: { schoolId: school.id } });
  const food = stores.find((s) => s.kind === "food")!;
  const uniform = stores.find((s) => s.kind === "uniform")!;
  const general = stores.find((s) => s.kind === "general")!;
  const lunch = await owner.meal.findFirstOrThrow({
    where: { schoolId: school.id, name: "Lunch" },
  });
  const sk = storekeeper.actor;
  const maize = await saveItem(deps, sk, {
    storeId: food.id,
    name: "Maize flour",
    unit: "kg",
    category: "Dry goods",
    reorderLevel: "50",
    packName: "90 kg bag",
    packSize: "90",
  });
  const oil = await saveItem(deps, sk, {
    storeId: food.id,
    name: "Cooking oil",
    unit: "litre",
    category: "Oils",
    packName: "20 L jerrycan",
    packSize: "20",
  });
  return {
    school,
    director,
    principal,
    storekeeper,
    cook,
    bursar,
    food,
    uniform,
    general,
    lunch,
    maize,
    oil,
  };
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const onHand = async (f: Fixture, itemId: string) =>
  withContext(
    app,
    { userId: f.director.user.id, schoolId: f.school.id },
    async (tx) =>
      (await itemPositions(tx, f.school.id, [itemId])).get(itemId) ?? {
        quantityMilli: 0,
        valueCents: 0,
      },
  );

let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeFixture("Stores A");
  B = await makeFixture("Stores B");
});

afterAll(async () => {
  await app.$disconnect();
  await appUnguarded.$disconnect();
  await owner.$disconnect();
});

describe("the stock ledger", () => {
  it("computes on hand from movements: packs in, issues, transfers and adjustments out", async () => {
    const f = await makeFixture("Ledger");
    const sk = f.storekeeper.actor;
    // 2 bags of 90 kg at KES 4,500 a bag: 180 kg, KES 9,000.
    await receiveStock(deps, sk, {
      itemId: f.maize.id,
      packs: "2",
      cost: "4500",
      costPer: "pack",
      deliveryNote: "DN-1",
    });
    expect(await onHand(f, f.maize.id)).toEqual({ quantityMilli: 180_000, valueCents: 900_000 });
    // 1 bag at KES 5,400: 270 kg, KES 14,400; the average is KES 53.33 a kg.
    await receiveStock(deps, sk, { itemId: f.maize.id, packs: "1", cost: "5400", costPer: "pack" });
    await issueStock(deps, sk, { itemId: f.maize.id, quantity: "27", issuedTo: "Staff room" });
    // 27 kg is a tenth of 270 kg: a tenth of the value (KES 1,440), at weighted average cost.
    expect(await onHand(f, f.maize.id)).toEqual({ quantityMilli: 243_000, valueCents: 1_296_000 });
    await transferStock(deps, sk, { itemId: f.maize.id, toStoreId: f.general.id, quantity: "3" });
    await adjustStock(deps, sk, { itemId: f.maize.id, quantity: "-0.5", reason: "Spilt bag" });
    const p = await onHand(f, f.maize.id);
    expect(p.quantityMilli).toBe(239_500);
    // The general store now holds the 3 kg (a new item, same unit) at the value it left with.
    const general = await storeStock(deps, sk, f.general.id);
    expect(general!.items.find((i) => i.name === "Maize flour")).toMatchObject({
      onHandMilli: 3_000,
      valueCents: 16_000,
    });
    // Not enough stock: refused, nothing written.
    await expect(
      issueStock(deps, sk, { itemId: f.maize.id, quantity: "1000", issuedTo: "Kitchen" }),
    ).rejects.toThrow(/Not enough/);
    // Adjustments need a reason; movements are append-only.
    await expect(adjustStock(deps, sk, { itemId: f.maize.id, quantity: "-1" })).rejects.toThrow(
      /why/,
    );
    await expect(
      owner.$executeRaw`UPDATE stock_movements SET quantity_milli = 1 WHERE school_id = ${f.school.id}::uuid`,
    ).rejects.toThrow();
    const log = await owner.auditLog.findFirst({
      where: { schoolId: f.school.id, action: "stores.adjust" },
    });
    expect(log?.after).toMatchObject({ reason: "Spilt bag", quantityMilli: -500 });
  });
});

describe("meals", () => {
  it("suggests from the ration scale and flags issues beyond the school's percentage", async () => {
    const f = await makeFixture("Meals");
    const sk = f.storekeeper.actor;
    await receiveStock(deps, sk, { itemId: f.maize.id, packs: "2", cost: "9000" });
    await receiveStock(deps, sk, { itemId: f.oil.id, packs: "1", cost: "6000" });
    await setRation(deps, sk, { mealId: f.lunch.id, itemId: f.maize.id, perStudent: "0.15" });
    await setRation(deps, sk, { mealId: f.lunch.id, itemId: f.oil.id, perStudent: "0.01" });
    const plan = (await mealPlan(deps, sk, f.lunch.id, 200))!;
    expect(plan.lines.map((l) => [l.name, l.suggestedMilli])).toEqual([
      ["Cooking oil", 2_000], // 10 ml x 200
      ["Maize flour", 30_000], // 150 g x 200
    ]);
    // Within 10%: no flag.
    const ok = await issueMeal(deps, sk, {
      mealId: f.lunch.id,
      served: "200",
      lines: [
        { itemId: f.maize.id, actual: "32" },
        { itemId: f.oil.id, actual: "2" },
      ],
    });
    expect(ok.flagged).toBe(false);
    expect(ok.costCents).toBe(160_000 + 60_000); // 32 kg of KES 50/kg + 2 L of KES 300/L
    // 40 kg of maize is a third more: flagged to the Director and Principal, with the amounts.
    const bad = await issueMeal(deps, sk, {
      mealId: f.lunch.id,
      served: "200",
      lines: [
        { itemId: f.maize.id, actual: "40" },
        { itemId: f.oil.id, actual: "2" },
      ],
    });
    expect(bad).toMatchObject({ flagged: true, varianceStatus: "open", variancePermille: 333 });
    const notes = await owner.notification.findMany({
      where: { schoolId: f.school.id, title: "Lunch: issue differs from the ration scale" },
    });
    expect(notes.map((n) => n.membershipId).sort()).toEqual(
      [f.director.membership.id, f.principal.membership.id].sort(),
    );
    expect(notes[0].body).toContain("Maize flour: 40 kg issued, 30 kg expected (+33.3%)");
    expect((await storesWidget(deps, f.director.actor)).openVariances).toBe(1);
    await expect(reviewVariance(deps, sk, bad.id, "ok")).rejects.toThrow(ForbiddenError);
    await reviewVariance(deps, f.principal.actor, bad.id, "Visitors at lunch");
    expect((await storesWidget(deps, f.director.actor)).openVariances).toBe(0);
  });

  it("the cook sees and confirms, but can never change stock", async () => {
    const f = await makeFixture("Cook");
    const sk = f.storekeeper.actor;
    const cook = f.cook.actor;
    await receiveStock(deps, sk, { itemId: f.maize.id, packs: "1", cost: "4500" });
    await setRation(deps, sk, { mealId: f.lunch.id, itemId: f.maize.id, perStudent: "0.15" });
    const issue = await issueMeal(deps, sk, {
      mealId: f.lunch.id,
      served: "100",
      lines: [{ itemId: f.maize.id, actual: "15" }],
    });
    await confirmServed(deps, cook, issue.id, "96");
    expect(
      (await owner.mealIssue.findUniqueOrThrow({ where: { id: issue.id } })).servedConfirmed,
    ).toBe(96);
    // In the app:
    await expect(
      issueStock(deps, cook, { itemId: f.maize.id, quantity: "1", issuedTo: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      receiveStock(deps, cook, { itemId: f.maize.id, quantity: "1", cost: "1" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      issueMeal(deps, cook, { mealId: f.lunch.id, served: "1", lines: [] }),
    ).rejects.toThrow(ForbiddenError);
    // And in the database: no stock movement, and no change to the meal's cost.
    const ctx = { userId: f.cook.user.id, schoolId: f.school.id };
    await expect(
      withContext(
        app,
        ctx,
        (tx) =>
          tx.$executeRaw`INSERT INTO stock_movements (school_id, store_id, item_id, kind, quantity_milli, value_cents, occurred_on, created_by_id)
          VALUES (${f.school.id}::uuid, ${f.food.id}::uuid, ${f.maize.id}::uuid, 'issue', -1000, 0, CURRENT_DATE, ${f.cook.user.id}::uuid)`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withContext(
        app,
        ctx,
        (tx) =>
          tx.$executeRaw`UPDATE meal_issues SET cost_cents = 0 WHERE school_id = ${f.school.id}::uuid AND id = ${issue.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("uniforms", () => {
  async function uniformSetup(label: string) {
    const f = await makeFixture(label);
    const vh = await owner.voteHead.create({
      data: { schoolId: f.school.id, name: "Uniform", priority: 5 },
    });
    const stream = await makeStream(f.school.id, "Grade 7", "East");
    const student = await makeStudent(f.school.id, stream.id, { firstName: "Baraka" });
    const sk = f.storekeeper.actor;
    const shirt12 = await saveItem(deps, sk, {
      storeId: f.uniform.id,
      name: "Shirt",
      size: "12",
      unit: "piece",
      price: "650",
    });
    const shirt14 = await saveItem(deps, sk, {
      storeId: f.uniform.id,
      name: "Shirt",
      size: "14",
      unit: "piece",
      price: "700",
    });
    await receiveStock(deps, sk, { itemId: shirt12.id, quantity: "10", cost: "4000" });
    await receiveStock(deps, sk, { itemId: shirt14.id, quantity: "10", cost: "4500" });
    return { f, vh, student, shirt12, shirt14, sk };
  }
  const charges = (schoolId: string, studentId: string) =>
    owner.ledgerEntry.findMany({
      where: { schoolId, studentId },
      orderBy: { createdAt: "asc" },
      include: { lines: true },
    });
  const balance = async (schoolId: string, studentId: string) =>
    (
      await owner.ledgerLine.aggregate({
        where: { schoolId, studentId },
        _sum: { amountCents: true },
      })
    )._sum.amountCents ?? 0;

  it("an issue makes exactly one fee charge on the Uniform vote head; a return reverses it", async () => {
    const { f, vh, student, shirt12, sk } = await uniformSetup("Uniform charge");
    const r = await issueUniform(deps, sk, {
      studentId: student.id,
      itemId: shirt12.id,
      quantity: "2",
      payment: "charged",
    });
    expect(r).toMatchObject({ status: "issued", totalCents: 130_000, charged: true });
    const after = await charges(f.school.id, student.id);
    expect(after.filter((e) => e.type === "charge")).toHaveLength(1);
    expect(after[0]).toMatchObject({
      type: "charge",
      amountCents: 130_000,
      description: "Uniform: Shirt (12) x2",
    });
    expect(after[0].lines).toEqual([
      expect.objectContaining({ voteHeadId: vh.id, amountCents: 130_000 }),
    ]);
    expect(await balance(f.school.id, student.id)).toBe(130_000);
    expect(
      (await storeStock(deps, sk, f.uniform.id))!.items.find((i) => i.id === shirt12.id)!
        .onHandMilli,
    ).toBe(8_000);

    // Returned: the stock is back, and the charge is reversed (never edited).
    await returnUniform(deps, sk, {
      issueId: r.status === "issued" ? r.issueId : "",
      reason: "Too small",
    });
    const entries = await charges(f.school.id, student.id);
    expect(entries.map((e) => e.type)).toEqual(["charge", "reversal"]);
    expect(entries[1]).toMatchObject({ amountCents: -130_000, reversesEntryId: entries[0].id });
    expect(await balance(f.school.id, student.id)).toBe(0);
    expect(
      (await storeStock(deps, sk, f.uniform.id))!.items.find((i) => i.id === shirt12.id)!
        .onHandMilli,
    ).toBe(10_000);
    // A second return is refused.
    await expect(
      returnUniform(deps, sk, { issueId: r.status === "issued" ? r.issueId : "", reason: "again" }),
    ).rejects.toThrow(/already been returned/);
  });

  it("warns about a double issue, and an exchange swaps the size and the charge together", async () => {
    const { f, student, shirt12, shirt14, sk } = await uniformSetup("Uniform double");
    const first = await issueUniform(deps, sk, {
      studentId: student.id,
      itemId: shirt12.id,
      quantity: "1",
      payment: "charged",
    });
    // The same garment again (any size): a warning showing what the student has.
    const second = await issueUniform(deps, sk, {
      studentId: student.id,
      itemId: shirt14.id,
      quantity: "1",
      payment: "charged",
    });
    expect(second).toMatchObject({
      status: "already_has",
      existing: [{ name: "Shirt", size: "12", quantity: 1 }],
    });
    expect((await charges(f.school.id, student.id)).length).toBe(1);
    // Exchange 12 for 14: one transaction, the 650 reversed and 700 charged.
    const ex = await returnUniform(deps, sk, {
      issueId: first.status === "issued" ? first.issueId : "",
      reason: "Wrong size",
      exchangeItemId: shirt14.id,
    });
    expect(ex.newIssue).toBeTruthy();
    const entries = await charges(f.school.id, student.id);
    expect(entries.map((e) => [e.type, e.amountCents])).toEqual([
      ["charge", 65_000],
      ["reversal", -65_000],
      ["charge", 70_000],
    ]);
    const list = await studentUniforms(deps, sk, student.id);
    expect(list.map((i) => [i.item.size, i.status])).toEqual([
      ["14", "issued"],
      ["12", "returned"],
    ]);
    // Paid separately: no charge, but a reference is required.
    await expect(
      issueUniform(deps, sk, {
        studentId: student.id,
        itemId: shirt12.id,
        quantity: "1",
        payment: "paid_separately",
        again: true,
      }),
    ).rejects.toThrow(/reference/);
    await issueUniform(deps, sk, {
      studentId: student.id,
      itemId: shirt12.id,
      quantity: "1",
      payment: "paid_separately",
      reference: "QJK1234XYZ",
      again: true,
    });
    expect((await charges(f.school.id, student.id)).length).toBe(3);
  });
});

describe("stock-takes", () => {
  it("count, submit, and only approval posts the adjustments", async () => {
    const f = await makeFixture("Stocktake");
    const sk = f.storekeeper.actor;
    await receiveStock(deps, sk, { itemId: f.maize.id, quantity: "100", cost: "5000" });
    await receiveStock(deps, sk, { itemId: f.oil.id, quantity: "20", cost: "6000" });
    const st = await startStocktake(deps, sk, f.food.id);
    await saveCounts(deps, sk, st.id, { [f.maize.id]: "97.5" });
    await expect(submitStocktake(deps, sk, st.id)).rejects.toThrow(/not counted/);
    await saveCounts(deps, sk, st.id, { [f.oil.id]: "20" });
    await submitStocktake(deps, sk, st.id);
    const d = (await stocktakeDetail(deps, sk, st.id))!;
    const maizeLine = d.lines.find((l) => l.itemId === f.maize.id)!;
    expect(maizeLine).toMatchObject({
      expectedMilli: 100_000,
      countedMilli: 97_500,
      valueCents: -12_500,
    });
    expect(d).toMatchObject({ differences: 1, totalValueCents: -12_500 });
    // Submitted, not approved: nothing has changed.
    expect((await onHand(f, f.maize.id)).quantityMilli).toBe(100_000);
    await expect(decideStocktake(deps, sk, st.id, true, null)).rejects.toThrow(ForbiddenError);
    const r = await decideStocktake(deps, f.principal.actor, st.id, true, "Rats in the store");
    expect(r.posted).toBe(1);
    expect(await onHand(f, f.maize.id)).toEqual({ quantityMilli: 97_500, valueCents: 487_500 });
    const m = await owner.stockMovement.findFirstOrThrow({
      where: { schoolId: f.school.id, stocktakeId: st.id },
    });
    expect(m).toMatchObject({ kind: "stocktake", quantityMilli: -2_500 });
    expect(m.reason).toContain("Rats in the store");
    // Rejected ones change nothing.
    const st2 = await startStocktake(deps, sk, f.food.id);
    await saveCounts(deps, sk, st2.id, { [f.maize.id]: "1", [f.oil.id]: "1" });
    await submitStocktake(deps, sk, st2.id);
    await decideStocktake(deps, f.director.actor, st2.id, false, "Recount");
    expect((await onHand(f, f.maize.id)).quantityMilli).toBe(97_500);
  });
});

describe("alerts", () => {
  it("lists items below reorder level and makes one daily digest", async () => {
    const f = await makeFixture("Alerts");
    const sk = f.storekeeper.actor;
    await receiveStock(deps, sk, { itemId: f.maize.id, quantity: "40", cost: "2000" }); // reorder level 50
    const w = await storesWidget(deps, f.director.actor);
    expect(w.low.map((l) => l.name)).toContain("Maize flour");
    expect(await ensureDailyDigest(deps, sk)).toBe(true);
    expect(await ensureDailyDigest(deps, sk)).toBe(false); // once a day
    const digest = await owner.notification.findMany({
      where: { schoolId: f.school.id, title: "Stores today" },
    });
    expect(digest.map((d) => d.membershipId).sort()).toEqual(
      [f.director.membership.id, f.storekeeper.membership.id].sort(),
    );
    await expect(storesWidget(deps, f.cook.actor)).rejects.toThrow(ForbiddenError);
  });
});

describe("school walls", () => {
  it("School B can never see School A's stores", async () => {
    await receiveStock(deps, A.storekeeper.actor, {
      itemId: A.maize.id,
      quantity: "10",
      cost: "500",
    });
    // Through the services: A's store and item are not found for B.
    expect(await storeStock(deps, B.storekeeper.actor, A.food.id)).toBeNull();
    await expect(
      issueStock(deps, B.storekeeper.actor, { itemId: A.maize.id, quantity: "1", issuedTo: "x" }),
    ).rejects.toThrow(/not found/);
    // Straight in the database: nothing of A's is visible to B.
    const asB = scopedDb(appUnguarded, { userId: B.director.user.id, schoolId: B.school.id });
    for (const count of [
      asB.stockMovement.count({ where: { schoolId: A.school.id } }),
      asB.storeItem.count({ where: { schoolId: A.school.id } }),
      asB.store.count({ where: { schoolId: A.school.id } }),
      asB.mealIssue.count({ where: { schoolId: A.school.id } }),
      asB.uniformIssue.count({ where: { schoolId: A.school.id } }),
    ])
      expect(await count).toBe(0);
    const sneaky = scopedDb(appUnguarded, { userId: B.director.user.id, schoolId: A.school.id });
    expect(await sneaky.stockMovement.count()).toBe(0);
  });
});
