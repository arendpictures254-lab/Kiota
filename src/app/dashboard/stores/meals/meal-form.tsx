"use client";

import { useActionState, useMemo, useState } from "react";
import { Notice } from "@/components/ui";
import type { FormState } from "@/lib/actions";
import { formatQty, parseQty, variancePermille } from "@/lib/stores/stock";
import { issueMealAction } from "../actions";

type Line = {
  itemId: string;
  name: string;
  unit: string;
  perStudentMilli: number;
  onHandMilli: number;
};

/**
 * Issue for a meal: students served (pre-filled), Kiota's suggestion per item from the ration
 * scale, and what was actually issued (pre-filled with the suggestion). Differences beyond the
 * school's percentage show in amber before saving.
 */
export function MealForm({
  mealId,
  date,
  served: initial,
  lines,
  thresholdPercent,
}: {
  mealId: string;
  date: string;
  served: number;
  lines: Line[];
  thresholdPercent: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(issueMealAction, {});
  const [served, setServed] = useState(String(initial));
  const n = Math.max(0, Math.floor(Number(served) || 0));
  const [actual, setActual] = useState<Record<string, string>>({});
  const rows = useMemo(
    () =>
      lines.map((l) => {
        const suggested = l.perStudentMilli * n;
        const typed = actual[l.itemId];
        const value = typed ?? String(suggested / 1000);
        const milli = parseQty(value);
        const v = milli === null ? null : variancePermille(suggested, milli);
        return {
          ...l,
          suggested,
          value,
          v,
          off: v !== null && Math.abs(v) > thresholdPercent * 10,
        };
      }),
    [lines, n, actual, thresholdPercent],
  );
  const flagged = rows.filter((r) => r.off).length;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="mealId" value={mealId} />
      <input type="hidden" name="date" value={date} />
      <label className="flex max-w-xs flex-col gap-1.5 text-sm font-semibold">
        Students served
        <input
          name="served"
          inputMode="numeric"
          value={served}
          onChange={(e) => setServed(e.target.value.replace(/\D/g, ""))}
          className="h-14 rounded-xl border border-ink/20 bg-white px-4 text-2xl font-bold"
        />
      </label>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3" aria-label="Items">
        {rows.map((r) => (
          <li
            key={r.itemId}
            className={`flex flex-col gap-2 rounded-2xl border-2 bg-white p-4 ${r.off ? "border-status-due" : "border-ink/10"}`}
            data-testid="meal-line"
          >
            <input type="hidden" name="itemId" value={r.itemId} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-ink">{r.name}</span>
              <span className="text-xs text-ink/60">
                in stock {formatQty(r.onHandMilli, r.unit)}
              </span>
            </div>
            <p className="text-sm text-ink/70">
              Suggested {formatQty(r.suggested, r.unit)} ({formatQty(r.perStudentMilli, r.unit)} ×{" "}
              {n})
            </p>
            <label className="flex items-center gap-2 text-sm font-semibold">
              Issued ({r.unit})
              <input
                name={`actual-${r.itemId}`}
                inputMode="decimal"
                value={r.value}
                onChange={(e) => setActual((a) => ({ ...a, [r.itemId]: e.target.value }))}
                className="h-12 w-32 rounded-xl border border-ink/20 bg-white px-3 text-lg"
              />
            </label>
            {r.off ? (
              <p className="text-sm font-semibold text-status-due">
                {r.v! > 0 ? "+" : ""}
                {(r.v! / 10).toFixed(1)}% against the ration scale: the Director will see this.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
        <p className="text-sm font-semibold text-ink">
          {rows.length} items ·{" "}
          {flagged ? `${flagged} beyond ${thresholdPercent}%` : `within ${thresholdPercent}%`}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-teal px-6 font-semibold text-white disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Saving…" : "Record issue"}
        </button>
      </div>
    </form>
  );
}
