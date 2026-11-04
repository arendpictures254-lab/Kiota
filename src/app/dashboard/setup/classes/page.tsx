import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { ctxOf } from "@/lib/service-kit";
import { enabledClasses } from "@/lib/structure/service";
import { addStreamAction, removeStreamAction, setClassTeacherAction } from "../actions";
import { Section, SetupShell, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Classes and streams · Kiota" };

export default function ClassesPage() {
  return (
    <SetupShell title="Classes and streams">
      <Suspense fallback={<Loading />}>
        <Classes />
      </Suspense>
    </SetupShell>
  );
}

async function Classes() {
  const { actor, structure } = await loadSetup();
  const classes = enabledClasses(structure);
  const staff = await withContext(deps.db, ctxOf(actor), (tx) =>
    tx.membership.findMany({
      where: { status: "active", roles: { none: { role: { key: "system_payments" } } } },
    }),
  );
  const staffOptions = staff
    .map((m) => ({ value: m.id, label: m.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <ActionForm action={addStreamAction} submitLabel="Add stream">
          <h2 className="font-heading text-lg font-bold">Add a stream</h2>
          <Select
            label="Class"
            name="classId"
            required
            placeholder="Choose a class"
            options={classes.map((c) => ({ value: c.id, label: `${c.name} (${c.levelName})` }))}
          />
          <Field label="Stream name" name="name" placeholder="East" required />
        </ActionForm>
      </Card>

      {classes.length === 0 ? <p className="text-ink/70">Switch on a level first.</p> : null}

      {classes.map((c) => (
        <Section key={c.id} title={`${c.name}`}>
          {c.streams.length === 0 ? (
            <p className="text-sm text-ink/60">
              No streams. Students can be placed in {c.name} directly.
            </p>
          ) : (
            c.streams.map((s) => (
              <Card key={s.id} className="flex flex-col gap-3">
                <p className="font-semibold">
                  {c.name} {s.name}
                </p>
                <ActionForm
                  action={setClassTeacherAction}
                  submitLabel="Save class teacher"
                  variant="secondary"
                >
                  <input type="hidden" name="streamId" value={s.id} />
                  <Select
                    label="Class teacher"
                    name="membershipId"
                    id={`teacher-${s.id}`}
                    defaultValue={s.classTeacherMembershipId ?? ""}
                    placeholder="No class teacher"
                    options={staffOptions}
                  />
                </ActionForm>
                <ActionForm
                  action={removeStreamAction}
                  submitLabel={`Remove ${s.name}`}
                  variant="danger"
                >
                  <input type="hidden" name="streamId" value={s.id} />
                </ActionForm>
              </Card>
            ))
          )}
        </Section>
      ))}
    </div>
  );
}
