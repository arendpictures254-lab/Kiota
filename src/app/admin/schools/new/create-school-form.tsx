"use client";

import { useActionState } from "react";
import { Button, Checkbox, Field, Notice } from "@/components/ui";
import { createSchoolAction, type CreateSchoolState } from "../../actions";

// Level keys for now. These become a configuration table with the school structure module.
const LEVELS = [
  { key: "pre_primary", label: "Pre-primary" },
  { key: "primary", label: "Primary (Grades 1–6)" },
  { key: "junior", label: "Junior school (Grades 7–9)" },
  { key: "senior", label: "Senior school (Grades 10–12)" },
  { key: "legacy_844", label: "8-4-4 (Forms 3–4)" },
];

export function CreateSchoolForm() {
  const [state, action, pending] = useActionState<CreateSchoolState, FormData>(
    createSchoolAction,
    {},
  );
  const err = (f: string) => (state.field === f ? state.error : undefined);
  const fields = ["name", "shortName", "county", "directorName", "directorPhone"];

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && !fields.includes(state.field ?? "") ? (
        <Notice tone="error">{state.error}</Notice>
      ) : null}
      <Field label="School name" name="name" required error={err("name")} />
      <Field
        label="Short name"
        name="shortName"
        maxLength={11}
        required
        error={err("shortName")}
        hint="Up to 11 letters. Parents see it as the SMS sender."
      />
      <Field label="County" name="county" required error={err("county")} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold text-ink">Levels offered</legend>
        {LEVELS.map((l) => (
          <Checkbox key={l.key} name="levels" value={l.key} label={l.label} />
        ))}
      </fieldset>
      <h2 className="font-heading text-lg font-bold">Director</h2>
      <Field
        label="Director's full name"
        name="directorName"
        required
        error={err("directorName")}
      />
      <Field
        label="Director's phone number"
        name="directorPhone"
        type="tel"
        inputMode="tel"
        placeholder="0712 345 678"
        required
        error={err("directorPhone")}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create school"}
      </Button>
    </form>
  );
}
