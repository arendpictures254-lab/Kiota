/**
 * Stores seed for Bahari Academy, through the real services (so stock values, weighted average
 * costs, fee charges and variance flags come out exactly as in use). Runs once: skipped when the
 * school already has stock movements (the stock and fee ledgers are append-only).
 *  - a food store with Kenyan items, pack sizes, a ration scale for three meals and three weeks
 *    of meal issues (two days flagged), deliveries from two suppliers;
 *  - a uniform store (shirts, trousers, skirts, sweaters, socks in sizes), some issues charged
 *    to students' fees (Brian Kamau's shows in the parent portal);
 *  - cooking oil below its reorder level, and an approved stock-take with a difference.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { nairobiDate } from "../src/lib/attendance/rules";
import { BUILT_IN_ROLES } from "../src/lib/auth/catalog";
import { effectivePermissions } from "../src/lib/auth/permissions";
import { createAppClient } from "../src/lib/db-core";
import type { Actor } from "../src/lib/service-kit";
import { issueMeal, setRation } from "../src/lib/stores/meals";
import { receiveStock, saveItem, saveSupplier } from "../src/lib/stores/service";
import {
  decideStocktake,
  saveCounts,
  startStocktake,
  submitStocktake,
} from "../src/lib/stores/stocktake";
import { issueUniform } from "../src/lib/stores/uniforms";

export const STORES_SEED = { storekeeper: "+254711000011", cook: "+254711000012" };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedStores(owner: PrismaClient, schoolId: string) {
  if ((await owner.stockMovement.count({ where: { schoolId } })) > 0) return;
  const actor = async (phone: string, role: string): Promise<Actor> => ({
    userId: (await owner.user.findUniqueOrThrow({ where: { phone } })).id,
    schoolId,
    permissions: effectivePermissions({
      rolePermissions: BUILT_IN_ROLES.find((r) => r.key === role)!.permissions,
      grants: [],
    }),
  });
  const app = createAppClient();
  const deps = { db: app };
  const rand = rng(90);
  try {
    const sk = await actor(STORES_SEED.storekeeper, "storekeeper");
    const director = await actor("+254711000001", "director");
    const stores = await owner.store.findMany({ where: { schoolId } });
    const food = stores.find((s) => s.kind === "food")!;
    const uniform = stores.find((s) => s.kind === "uniform")!;
    const meals = await owner.meal.findMany({ where: { schoolId } });
    const meal = (name: string) => meals.find((m) => m.name === name)!;

    // ---- Suppliers ----
    const wholesaler = await saveSupplier(deps, sk, {
      name: "Kilifi Wholesalers",
      phone: "0722 410 220",
      kraPin: "P051234567X",
    });
    const cereals = await saveSupplier(deps, sk, {
      name: "Mombasa Cereals Ltd",
      phone: "0733 118 905",
    });
    const tailor = await saveSupplier(deps, sk, {
      name: "Pwani School Outfitters",
      phone: "0711 902 450",
    });

    // ---- Food items: [name, unit, category, pack name, pack size, reorder level, expiry?] ----
    const foodItems = [
      ["Maize flour", "kg", "Dry goods", "90 kg bag", "90", "60", false],
      ["Rice", "kg", "Dry goods", "50 kg bag", "50", "40", false],
      ["Beans", "kg", "Dry goods", "90 kg bag", "90", "15", false],
      ["Githeri mix", "kg", "Dry goods", "50 kg bag", "50", "25", false],
      ["Sugar", "kg", "Dry goods", "50 kg bag", "50", "20", false],
      ["Salt", "kg", "Dry goods", "20 kg bale", "20", "5", false],
      ["Tea leaves", "kg", "Dry goods", "5 kg carton", "5", "1", false],
      ["Cooking oil", "litre", "Oils", "20 L jerrycan", "20", "30", false],
      ["Cabbages", "piece", "Fresh produce", null, null, "20", true],
      ["Potatoes", "kg", "Fresh produce", "50 kg bag", "50", "30", true],
    ] as const;
    const item: Record<string, { id: string }> = {};
    for (const [name, unit, category, packName, packSize, reorder, expiry] of foodItems)
      item[name] = await saveItem(deps, sk, {
        storeId: food.id,
        name,
        unit,
        category,
        packName: packName ?? "",
        packSize: packSize ?? "",
        reorderLevel: reorder,
        tracksExpiry: expiry ? "on" : "",
      });

    // ---- Ration scale (per student) ----
    const rations: [string, string, string][] = [
      ["Breakfast", "Tea leaves", "0.004"],
      ["Breakfast", "Sugar", "0.025"],
      ["Lunch", "Maize flour", "0.15"],
      ["Lunch", "Beans", "0.08"],
      ["Lunch", "Cooking oil", "0.01"],
      ["Lunch", "Salt", "0.003"],
      ["Lunch", "Cabbages", "0.1"],
      ["Supper", "Rice", "0.12"],
      ["Supper", "Githeri mix", "0.1"],
      ["Supper", "Potatoes", "0.1"],
      ["Supper", "Cooking oil", "0.008"],
      ["Supper", "Salt", "0.003"],
    ];
    for (const [m, i, per] of rations)
      await setRation(deps, sk, { mealId: meal(m).id, itemId: item[i].id, perStudent: per });

    // ---- Deliveries: three weeks ago and ten days ago (prices rise a little) ----
    const today = nairobiDate(new Date());
    const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const deliveries: [string, string, string, string, string, number][] = [
      // item, packs, cost per pack (KES), supplier, delivery note, days ago
      ["Maize flour", "2", "5850", cereals.id, "MC-4410", 22],
      ["Rice", "1", "7400", cereals.id, "MC-4410", 22],
      ["Beans", "1", "11700", cereals.id, "MC-4410", 22],
      ["Githeri mix", "2", "4600", cereals.id, "MC-4410", 22],
      ["Sugar", "1", "7250", wholesaler.id, "KW-118", 22],
      ["Salt", "1", "560", wholesaler.id, "KW-118", 22],
      ["Tea leaves", "1", "2100", wholesaler.id, "KW-118", 22],
      ["Cooking oil", "2", "5400", wholesaler.id, "KW-118", 22],
      ["Potatoes", "2", "2500", wholesaler.id, "KW-119", 22],
      ["Maize flour", "1", "6100", cereals.id, "MC-4502", 10],
      ["Rice", "2", "7600", cereals.id, "MC-4502", 10],
      ["Githeri mix", "1", "4700", cereals.id, "MC-4502", 10],
      ["Potatoes", "1", "2600", wholesaler.id, "KW-131", 10],
      ["Sugar", "1", "7300", wholesaler.id, "KW-131", 10],
    ];
    for (const [i, packs, cost, supplierId, dn, ago] of deliveries)
      await receiveStock(deps, sk, {
        itemId: item[i].id,
        packs,
        cost,
        costPer: "pack",
        supplierId,
        deliveryNote: dn,
        date: iso(daysAgo(ago)),
        expiryDate: i === "Potatoes" ? iso(daysAgo(ago - 30)) : "",
      });
    // Cabbages come by the piece, weekly, and keep about ten days.
    for (const ago of [22, 15, 8, 1])
      await receiveStock(deps, sk, {
        itemId: item["Cabbages"].id,
        quantity: "35",
        cost: "45",
        costPer: "unit",
        supplierId: wholesaler.id,
        deliveryNote: `KW-C${ago}`,
        date: iso(daysAgo(ago)),
        expiryDate: iso(daysAgo(ago - 10)),
      });

    // ---- Three weeks of meals (two flagged days) ----
    const boarders = await owner.student.count({
      where: { schoolId, status: "active", boarder: true },
    });
    const perStudent = new Map(rations.map(([m, i, per]) => [`${m}:${i}`, Number(per)]));
    for (let ago = 21; ago >= 1; ago--) {
      const date = iso(daysAgo(ago));
      for (const m of ["Breakfast", "Lunch", "Supper"]) {
        const served = boarders - Math.floor(rand() * 3);
        const lines = rations
          .filter(([mm]) => mm === m)
          .map(([, i]) => {
            let factor = 0.97 + rand() * 0.06; // within ±3%
            if (ago === 12 && m === "Lunch" && i === "Maize flour") factor = 1.28; // flagged
            if (ago === 5 && m === "Breakfast" && i === "Sugar") factor = 1.4; // flagged
            const raw = perStudent.get(`${m}:${i}`)! * served * factor;
            // Pieces (cabbages) are issued whole.
            const qty = i === "Cabbages" ? Math.max(1, Math.round(raw)) : raw;
            return { itemId: item[i].id, actual: (Math.round(qty * 1000) / 1000).toFixed(3) };
          });
        await issueMeal(
          deps,
          sk,
          { mealId: meal(m).id, date, served: String(served), lines },
          new Date(),
        );
      }
    }

    // ---- A stock-take of the food store, approved, with a difference (sugar short) ----
    const st = await startStocktake(deps, sk, food.id);
    const onHand = await owner.stockMovement.groupBy({
      by: ["itemId"],
      where: { schoolId, storeId: food.id },
      _sum: { quantityMilli: true },
    });
    const counts: Record<string, string> = {};
    for (const o of onHand) {
      const q = (o._sum.quantityMilli ?? 0) / 1000;
      counts[o.itemId] = String(o.itemId === item["Sugar"].id ? Math.max(0, q - 2) : q);
    }
    const lines = await owner.stocktakeLine.findMany({ where: { schoolId, stocktakeId: st.id } });
    for (const l of lines) counts[l.itemId] ??= "0";
    await saveCounts(deps, sk, st.id, counts);
    await submitStocktake(deps, sk, st.id);
    await decideStocktake(
      deps,
      director,
      st.id,
      true,
      "Sugar short by 2 kg: storeroom lock replaced",
    );

    // ---- Uniform store ----
    const garments: [string, string[], string][] = [
      ["Shirt", ["10", "12", "14", "16"], "650"],
      ["Trousers", ["26", "28", "30"], "1200"],
      ["Skirt", ["24", "26", "28"], "1100"],
      ["Sweater", ["S", "M", "L"], "1500"],
      ["Socks (pair)", [""], "250"],
    ];
    const uni: Record<string, { id: string }> = {};
    for (const [name, sizes, price] of garments)
      for (const size of sizes) {
        const it = await saveItem(deps, sk, {
          storeId: uniform.id,
          name,
          size,
          unit: "piece",
          category: name,
          price,
          reorderLevel: "5",
        });
        uni[`${name}:${size}`] = it;
        await receiveStock(deps, sk, {
          itemId: it.id,
          quantity: name === "Socks (pair)" ? "80" : "20",
          cost: String(Math.round(Number(price) * 0.62)),
          costPer: "unit",
          supplierId: tailor.id,
          deliveryNote: "PSO-77",
          date: iso(daysAgo(25)),
        });
      }
    const students = await owner.student.findMany({
      where: { schoolId, status: "active" },
      orderBy: { admissionNumber: "asc" },
      take: 8,
    });
    const brian = await owner.student.findFirst({
      where: { schoolId, admissionNumber: "BA/2024/101" },
    });
    const issues: [string | undefined, string, string, string][] = [
      [brian?.id, "Shirt:14", "2", "charged"],
      [brian?.id, "Sweater:M", "1", "charged"],
      [students[0]?.id, "Shirt:12", "2", "charged"],
      [students[0]?.id, "Skirt:26", "1", "charged"],
      [students[1]?.id, "Trousers:28", "1", "paid_separately"],
      [students[2]?.id, "Socks (pair):", "3", "charged"],
      [students[3]?.id, "Sweater:S", "1", "charged"],
    ];
    for (const [studentId, key, qty, payment] of issues) {
      if (!studentId) continue;
      await issueUniform(deps, sk, {
        studentId,
        itemId: uni[key].id,
        quantity: qty,
        payment,
        reference: payment === "paid_separately" ? "QKX5T2M9LP" : undefined,
        again: true,
      });
    }
  } finally {
    await app.$disconnect();
  }
}
