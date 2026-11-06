import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Select } from "@/components/ui";
import {
  addPathwayAction,
  addSubjectAction,
  removePathwayAction,
  removeSubjectAction,
} from "../actions";
import { Section, SetupShell, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Subjects · Kiota" };

export default function SubjectsPage() {
  return (
    <SetupShell title="Subjects">
      <Suspense fallback={<Loading />}>
        <Subjects />
      </Suspense>
    </SetupShell>
  );
}

async function Subjects() {
  const { structure } = await loadSetup();
  const levels = structure.levels.filter((l) => l.enabled);
  const senior = levels.find((l) => l.key === "senior");
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <ActionForm action={addSubjectAction} submitLabel="Add subject">
          <h2 className="font-heading text-section font-bold">Add a subject or learning area</h2>
          <Select
            label="Level"
            name="levelId"
            required
            options={levels.map((l) => ({ value: l.id, label: l.name }))}
          />
          <Field
            label="Name"
            name="name"
            id="subject-name"
            placeholder="Computer Science"
            required
          />
          <Field label="Code" name="code" hint="Optional, for example 451." />
        </ActionForm>
      </Card>

      {levels.map((level) => (
        <Section key={level.id} title={level.name}>
          <ul className="flex flex-col gap-2">
            {level.subjects.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center justify-between gap-3 py-3">
                  <span>
                    {s.name}
                    {s.code ? <span className="text-ink/60"> · {s.code}</span> : null}
                  </span>
                  <ActionForm
                    action={removeSubjectAction}
                    submitLabel="Remove"
                    variant="danger"
                    className="w-28"
                  >
                    <input type="hidden" name="subjectId" value={s.id} />
                  </ActionForm>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {senior ? (
        <Section title="Senior school pathways">
          {senior.pathways.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3 py-3">
              <span>{p.name}</span>
              <ActionForm
                action={removePathwayAction}
                submitLabel="Remove"
                variant="danger"
                className="w-28"
              >
                <input type="hidden" name="pathwayId" value={p.id} />
              </ActionForm>
            </Card>
          ))}
          <ActionForm action={addPathwayAction} submitLabel="Add pathway" variant="secondary">
            <input type="hidden" name="levelId" value={senior.id} />
            <Field label="New pathway" name="name" id="pathway-name" placeholder="STEM" required />
          </ActionForm>
          <p className="text-sm text-ink/60">
            Each senior student&apos;s pathway and subject combination is set on their profile.
          </p>
        </Section>
      ) : null}
    </div>
  );
}
