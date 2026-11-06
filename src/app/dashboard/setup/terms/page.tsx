import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Select } from "@/components/ui";
import { addTermAction, addYearAction, removeTermAction } from "../actions";
import { Section, SetupShell, fmtDate, loadSetup } from "../shared";

export const metadata: Metadata = { title: "Terms · Kiota" };

export default function TermsPage() {
  return (
    <SetupShell title="Terms">
      <Suspense fallback={<Loading />}>
        <Terms />
      </Suspense>
    </SetupShell>
  );
}

async function Terms() {
  const { structure } = await loadSetup();
  return (
    <div className="flex flex-col gap-6">
      {structure.years.map((y) => (
        <Section key={y.id} title={`${y.name} (${fmtDate(y.startDate)} – ${fmtDate(y.endDate)})`}>
          {y.terms.length === 0 ? <p className="text-sm text-ink/60">No terms yet.</p> : null}
          {y.terms.map((t) => (
            <Card key={t.id} className="flex flex-col gap-2">
              <p className="font-semibold">{t.name}</p>
              <p className="text-sm text-ink/70">
                Opens {fmtDate(t.startDate)} · Closes {fmtDate(t.endDate)}
                {t.halfTermStart
                  ? ` · Half-term ${fmtDate(t.halfTermStart)} – ${fmtDate(t.halfTermEnd)}`
                  : ""}
              </p>
              <ActionForm
                action={removeTermAction}
                submitLabel={`Remove ${t.name}`}
                variant="danger"
              >
                <input type="hidden" name="termId" value={t.id} />
              </ActionForm>
            </Card>
          ))}
        </Section>
      ))}

      {structure.years.length > 0 ? (
        <Card>
          <ActionForm action={addTermAction} submitLabel="Add term">
            <h2 className="font-heading text-section font-bold">Add a term</h2>
            <Select
              label="Academic year"
              name="academicYearId"
              required
              options={structure.years.map((y) => ({ value: y.id, label: y.name }))}
            />
            <Field label="Term name" name="name" id="term-name" placeholder="Term 1" required />
            <Field label="Opening date" name="startDate" id="term-start" type="date" required />
            <Field label="Half-term starts" name="halfTermStart" type="date" hint="Optional" />
            <Field label="Half-term ends" name="halfTermEnd" type="date" />
            <Field label="Closing date" name="endDate" id="term-end" type="date" required />
          </ActionForm>
        </Card>
      ) : null}

      <Card>
        <ActionForm action={addYearAction} submitLabel="Add academic year" variant="secondary">
          <h2 className="font-heading text-section font-bold">Add an academic year</h2>
          <Field label="Year name" name="name" id="year-name" placeholder="2027" required />
          <Field label="Starts" name="startDate" id="year-start" type="date" required />
          <Field label="Ends" name="endDate" id="year-end" type="date" required />
        </ActionForm>
      </Card>
    </div>
  );
}
