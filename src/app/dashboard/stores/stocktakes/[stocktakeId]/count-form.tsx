"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/ui";
import type { FormState } from "@/lib/actions";
import { countsAction } from "../../actions";

type Line = { itemId: string; name: string; unit: string; group: string; counted: number | null };

/**
 * Counting on a phone or tablet: items grouped by shelf, a big number box each (counts are typed
 * in the item's unit), "Save" while counting and "Submit" when done.
 */
export function CountForm({ stocktakeId, lines }: { stocktakeId: string; lines: Line[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(countsAction, {});
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.itemId, l.counted === null ? "" : String(l.counted / 1000)]),
    ),
  );
  const groups = [...new Set(lines.map((l) => l.group))];
  const counted = Object.values(values).filter((v) => v.trim() !== "").length;
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="stocktakeId" value={stocktakeId} />
      {groups.map((g) => (
        <section key={g} className="flex flex-col gap-2">
          <h2 className="font-heading text-section font-bold">{g}</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {lines
              .filter((l) => l.group === g)
              .map((l) => (
                <li key={l.itemId}>
                  <label className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-2">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{l.name}</span>
                      <span className="block text-xs text-ink/60">count in {l.unit}</span>
                    </span>
                    <input
                      name={`count-${l.itemId}`}
                      inputMode="decimal"
                      enterKeyHint="next"
                      aria-label={`${l.name}: count`}
                      value={values[l.itemId]}
                      onChange={(e) => setValues((v) => ({ ...v, [l.itemId]: e.target.value }))}
                      className="h-12 w-28 shrink-0 rounded-xl border border-ink/20 bg-white px-3 text-right text-xl font-bold"
                    />
                  </label>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
        <p className="text-sm font-semibold text-ink">
          {counted} of {lines.length} counted
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            name="intent"
            value="save"
            disabled={pending}
            className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal"
          >
            Save
          </button>
          <button
            type="submit"
            name="intent"
            value="submit"
            disabled={pending}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-teal px-5 font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </form>
  );
}
