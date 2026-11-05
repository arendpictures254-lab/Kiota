"use client";

import { useActionState } from "react";
import { setLanguageAction } from "@/app/session-actions";
import { Button, Notice } from "@/components/ui";

export function LanguageForm({
  current,
  text,
}: {
  current: "en" | "sw";
  text: Record<"hint" | "save" | "en" | "sw" | "label", string>;
}) {
  const [state, action, pending] = useActionState(setLanguageAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{text.label}</legend>
        {(["en", "sw"] as const).map((l) => (
          <label
            key={l}
            className="flex min-h-12 items-center gap-3 rounded-xl border border-ink/10 bg-white px-4"
            lang={l}
          >
            <input
              type="radio"
              name="language"
              value={l}
              defaultChecked={current === l}
              className="size-5 accent-teal"
            />
            <span className="font-semibold">{text[l]}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-ink/60">{text.hint}</p>
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {text.save}
      </Button>
    </form>
  );
}
