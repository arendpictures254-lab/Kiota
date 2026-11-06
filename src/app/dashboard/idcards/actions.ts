"use server";

import { revalidatePath } from "next/cache";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { updateCardContacts } from "@/lib/idcards/service";

export async function cardContactsAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => updateCardContacts(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  revalidatePath("/dashboard/idcards");
  return r;
}
