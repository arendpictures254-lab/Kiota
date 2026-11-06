import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Loading, Notice, Select } from "@/components/ui";
import { previewPromotion } from "@/lib/students/promotion";
import { deps } from "@/lib/actions";
import { ValidationError } from "@/lib/service-kit";
import { enabledClasses } from "@/lib/structure/service";
import { promoteAction } from "../actions";
import { SetupShell, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Promote a class · Kiota" };

export default function PromotePage({ searchParams }: PageProps<"/dashboard/setup/promote">) {
  return (
    <SetupShell title="Promote a class">
      <Suspense fallback={<Loading />}>
        <Promote searchParams={searchParams} />
      </Suspense>
    </SetupShell>
  );
}

async function Promote({
  searchParams,
}: Pick<PageProps<"/dashboard/setup/promote">, "searchParams">) {
  const { actor, structure } = await loadSetup();
  const { classId } = await searchParams;
  const classes = enabledClasses(structure);
  const selected = typeof classId === "string" ? classes.find((c) => c.id === classId) : undefined;
  const canPromote = actor.permissions.has("students.edit");

  let plan = null;
  let problem: string | null = null;
  if (selected && canPromote) {
    try {
      plan = await previewPromotion(deps, actor, selected.id);
    } catch (err) {
      if (err instanceof ValidationError) problem = err.message;
      else throw err;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink/70">
        At the end of the academic year, move a whole class up. Start with the highest class (for
        example Grade 9 before Grade 8), so years never mix.
      </p>
      <form method="get" className="flex flex-col gap-3">
        <Select
          label="Class to promote"
          name="classId"
          defaultValue={selected?.id ?? ""}
          placeholder="Choose a class"
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Button type="submit" variant="secondary">
          Preview
        </Button>
      </form>

      {!canPromote ? <Notice tone="error">You need permission to edit students.</Notice> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}

      {plan ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-section font-bold">
            {plan.toClass
              ? `${plan.fromClass.name} → ${plan.toClass.name}`
              : `${plan.fromClass.name} → Graduated`}
          </h2>
          <ul className="flex flex-col gap-1 text-ink/80">
            {plan.moves.map((m) => (
              <li key={m.fromStream ?? "none"}>
                {m.count} student{m.count === 1 ? "" : "s"}
                {m.fromStream ? ` in ${plan.fromClass.name} ${m.fromStream}` : ""}
                {plan.toClass
                  ? ` → ${plan.toClass.name}${m.toStream ? ` ${m.toStream}` : ""}${m.createStream ? " (new stream)" : ""}`
                  : " will be marked graduated"}
              </li>
            ))}
          </ul>
          {plan.warnings.map((w) => (
            <Notice key={w} tone="error">
              {w}
            </Notice>
          ))}
          {plan.total > 0 ? (
            <ActionForm
              action={promoteAction}
              submitLabel={
                plan.toClass ? `Promote ${plan.total} students` : `Graduate ${plan.total} students`
              }
              pendingLabel="Promoting…"
            >
              <input type="hidden" name="classId" value={plan.fromClass.id} />
            </ActionForm>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
