"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { confirmServed, issueMeal, reviewVariance, saveMeal, setRation } from "@/lib/stores/meals";
import {
  adjustStock,
  issueStock,
  receiveStock,
  saveItem,
  saveStore,
  saveSupplier,
  transferStock,
  updateStoresSettings,
} from "@/lib/stores/service";
import {
  decideStocktake,
  saveCounts,
  startStocktake,
  submitStocktake,
} from "@/lib/stores/stocktake";
import { issueUniform, returnUniform } from "@/lib/stores/uniforms";

const done = () => revalidatePath("/dashboard", "layout");

export async function receiveAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => receiveStock(deps, await currentActor(), formObject(form)),
    "Received.",
  );
  done();
  return r;
}

export async function issueAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => issueStock(deps, await currentActor(), formObject(form)),
    "Issued.",
  );
  done();
  return r;
}

export async function transferAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => transferStock(deps, await currentActor(), formObject(form)),
    "Moved.",
  );
  done();
  return r;
}

export async function adjustAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => adjustStock(deps, await currentActor(), formObject(form)),
    "Adjusted.",
  );
  done();
  return r;
}

export async function itemAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveItem(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function storeAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveStore(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function supplierAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveSupplier(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function storesSettingsAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => updateStoresSettings(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function mealAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveMeal(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function rationAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(
    async () =>
      setRation(deps, await currentActor(), {
        mealId: o.mealId,
        itemId: o.itemId,
        perStudent: o.perStudent,
      }),
    "Saved.",
  );
  done();
  return r;
}

export async function issueMealAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  let id = "";
  const r = await attempt(async () => {
    const lines = form
      .getAll("itemId")
      .map(String)
      .map((itemId) => ({ itemId, actual: String(form.get(`actual-${itemId}`) ?? "") }));
    const res = await issueMeal(deps, await currentActor(), {
      mealId: o.mealId ?? "",
      date: o.date,
      served: o.served,
      lines,
    });
    id = res.id;
  });
  if (r.error) return r;
  done();
  redirect(`/dashboard/stores/meals/${id}?new=1`);
}

export async function confirmServedAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(
    async () => confirmServed(deps, await currentActor(), o.issueId ?? "", o.served),
    "Thank you: the number served is recorded.",
  );
  done();
  return r;
}

export async function reviewVarianceAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(
    async () => reviewVariance(deps, await currentActor(), o.issueId ?? "", o.note),
    "Marked as reviewed.",
  );
  done();
  return r;
}

export async function issueUniformAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(async () => {
    const res = await issueUniform(deps, await currentActor(), {
      studentId: o.studentId ?? "",
      itemId: o.itemId ?? "",
      quantity: o.quantity,
      payment: o.payment,
      reference: o.reference,
      again: o.again === "1",
    });
    if (res.status === "already_has") {
      const list = res.existing.map((e) => `${e.name}${e.size ? ` (${e.size})` : ""}`).join(", ");
      throw new AlreadyHas(`Already issued: ${list}. Tick "Issue again" if this is meant.`);
    }
  }, "Issued.").catch((e) => {
    if (e instanceof AlreadyHas) return { error: e.message, field: "again" };
    throw e;
  });
  done();
  return r;
}

class AlreadyHas extends Error {}

export async function returnUniformAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const r = await attempt(
    async () =>
      returnUniform(deps, await currentActor(), {
        issueId: o.issueId ?? "",
        reason: o.reason,
        exchangeItemId: o.exchangeItemId || null,
      }),
    o.exchangeItemId ? "Exchanged: the charge is corrected." : "Returned: the charge is reversed.",
  );
  done();
  return r;
}

export async function startStocktakeAction(_s: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const r = await attempt(async () => {
    id = (await startStocktake(deps, await currentActor(), String(form.get("storeId") ?? ""))).id;
  });
  if (r.error) return r;
  redirect(`/dashboard/stores/stocktakes/${id}`);
}

export async function countsAction(_s: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("stocktakeId") ?? "");
  const counts: Record<string, string> = {};
  for (const [k, v] of form.entries())
    if (k.startsWith("count-") && typeof v === "string") counts[k.slice(6)] = v;
  const submit = form.get("intent") === "submit";
  const r = await attempt(
    async () => {
      const actor = await currentActor();
      await saveCounts(deps, actor, id, counts);
      if (submit) await submitStocktake(deps, actor, id);
    },
    submit ? "Submitted for approval." : "Counts saved.",
  );
  revalidatePath(`/dashboard/stores/stocktakes/${id}`);
  return r;
}

export async function decideStocktakeAction(_s: FormState, form: FormData): Promise<FormState> {
  const o = formObject(form);
  const approve = o.intent === "approve";
  const r = await attempt(
    async () => decideStocktake(deps, await currentActor(), o.stocktakeId ?? "", approve, o.note),
    approve ? "Approved: the differences are posted." : "Rejected: nothing changed.",
  );
  done();
  return r;
}
