import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { getFeeSetup } from "@/lib/fees/setup";
import { saveStructureAction } from "../../actions";
import { FeesShell, loadFeesActor } from "../../shared";

export const metadata: Metadata = { title: "Fee structure · Kiota" };

type Props = PageProps<"/dashboard/fees/setup/structure">;

export default function StructurePage({ searchParams }: Props) {
  return (
    <FeesShell title="Fee structure" back={{ href: "/dashboard/fees/setup", label: "Fee setup" }}>
      <Suspense fallback={<Loading />}>
        <Structure searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Structure({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadFeesActor("fees.setup");
  const sp = await searchParams;
  const s = await getFeeSetup(deps, actor);
  const pick = (v: unknown) => (typeof v === "string" ? v : "");
  const existing = s.structures.find(
    (x) =>
      x.termId === pick(sp.termId) &&
      x.levelId === pick(sp.levelId) &&
      x.appliesTo === pick(sp.appliesTo),
  );
  const amount = (itemId: string) => {
    const l = existing?.lines.find((x) => x.feeItemId === itemId);
    return l ? String(l.amountCents / 100) : "";
  };

  return (
    <ActionForm action={saveStructureAction} submitLabel="Save fee structure">
      <Select
        label="Term"
        name="termId"
        defaultValue={existing?.termId ?? pick(sp.termId)}
        required
        options={s.terms.map((t) => ({ value: t.id, label: `${t.name} ${t.academicYear.name}` }))}
      />
      <Select
        label="Level"
        name="levelId"
        defaultValue={existing?.levelId ?? pick(sp.levelId)}
        required
        options={s.levels.map((l) => ({ value: l.id, label: l.name }))}
      />
      <Select
        label="For"
        name="appliesTo"
        defaultValue={existing?.appliesTo ?? (pick(sp.appliesTo) || "boarder")}
        options={[
          { value: "boarder", label: "Boarders" },
          { value: "day", label: "Day scholars" },
        ]}
      />
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4">
        <legend className="px-1 font-heading font-bold">Amounts per term (KES)</legend>
        <p className="text-sm text-ink/60">Leave blank what this group does not pay.</p>
        {s.feeItems.map((i) => (
          <Field
            key={i.id}
            label={`${i.name} (${i.voteHead.name})`}
            name={`amount_${i.id}`}
            id={`amount_${i.id}`}
            inputMode="decimal"
            defaultValue={amount(i.id)}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4">
        <legend className="px-1 font-heading font-bold">Instalments</legend>
        <p className="text-sm text-ink/60">
          Optional. Percentages must add up to 100. Used to find overdue balances.
        </p>
        {[0, 1, 2, 3].map((k) => {
          const inst = existing?.installments[k];
          return (
            <div key={k} className="grid grid-cols-2 gap-3">
              <Field
                label={`Due date ${k + 1}`}
                name={`due_${k}`}
                type="date"
                defaultValue={inst ? inst.dueDate.toISOString().slice(0, 10) : ""}
              />
              <Field
                label="Percent"
                name={`pct_${k}`}
                inputMode="decimal"
                defaultValue={inst ? String(inst.percentBp / 100) : ""}
              />
            </div>
          );
        })}
      </fieldset>
    </ActionForm>
  );
}
