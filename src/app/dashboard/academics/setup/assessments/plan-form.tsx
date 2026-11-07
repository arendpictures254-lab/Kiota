"use client";

import { useActionState, useState } from "react";
import { Button, Notice } from "@/components/ui";
import type { FormState } from "@/lib/actions";
import { assessmentPlanAction } from "../../actions";

type Row = {
  id: string;
  name: string;
  maxMarks: string;
  weight: string;
  overrides: Record<string, string>;
  marks: number;
};

/**
 * A term and level's assessments: name, maximum marks and weight, plus a subject's own weight
 * where it differs (e.g. a project only in Creative Arts). Each subject's total shows live and
 * must reach 100% before it saves.
 */
export function PlanForm({
  termId,
  levelId,
  subjects,
  initial,
}: {
  termId: string;
  levelId: string;
  subjects: { id: string; name: string }[];
  initial: Row[];
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.length
      ? initial
      : [
          { id: "", name: "CAT 1", maxMarks: "30", weight: "15", overrides: {}, marks: 0 },
          { id: "", name: "CAT 2", maxMarks: "30", weight: "15", overrides: {}, marks: 0 },
          { id: "", name: "End-term", maxMarks: "100", weight: "70", overrides: {}, marks: 0 },
        ],
  );
  const [state, action, pending] = useActionState<FormState, FormData>(assessmentPlanAction, {});
  const [showSubjects, setShowSubjects] = useState(
    initial.some((r) => Object.keys(r.overrides).length),
  );
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const totalFor = (subjectId: string) =>
    rows.reduce((sum, r) => sum + Number(r.overrides[subjectId] ?? r.weight ?? 0), 0);
  const defaultTotal = rows.reduce((s, r) => s + Number(r.weight || 0), 0);
  const bad = subjects.filter((s) => totalFor(s.id) !== 100);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="termId" value={termId} />
      <input type="hidden" name="levelId" value={levelId} />
      <input type="hidden" name="rows" value={rows.length} />
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li
            key={i}
            className="grid grid-cols-2 items-end gap-2 rounded-2xl border border-ink/10 bg-white p-3 sm:grid-cols-[1fr_8rem_8rem_auto]"
          >
            <input type="hidden" name={`id-${i}`} value={r.id} />
            <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold sm:col-span-1">
              Assessment
              <input
                name={`name-${i}`}
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
                className="h-12 rounded-xl border border-ink/20 px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Out of
              <input
                name={`max-${i}`}
                inputMode="numeric"
                value={r.maxMarks}
                onChange={(e) => set(i, { maxMarks: e.target.value })}
                className="h-12 rounded-xl border border-ink/20 px-3 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Weight %
              <input
                name={`weight-${i}`}
                inputMode="numeric"
                value={r.weight}
                onChange={(e) => set(i, { weight: e.target.value })}
                className="h-12 rounded-xl border border-ink/20 px-3 text-base font-normal"
              />
            </label>
            <button
              type="button"
              disabled={r.marks > 0}
              title={r.marks ? "Has marks: cannot be removed" : undefined}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              className="col-span-2 min-h-11 rounded-xl px-3 text-sm font-semibold text-status-overdue disabled:text-ink/30 sm:col-span-1"
            >
              Remove
            </button>
            {subjects.map((s) => (
              <input
                key={s.id}
                type="hidden"
                name={`o-${i}-${s.id}`}
                value={r.overrides[s.id] ?? ""}
              />
            ))}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { id: "", name: "", maxMarks: "100", weight: "0", overrides: {}, marks: 0 },
            ])
          }
          className="min-h-11 rounded-xl border border-teal/30 bg-white px-4 text-sm font-semibold text-teal"
        >
          Add an assessment
        </button>
        <p
          className={`text-sm font-semibold ${defaultTotal === 100 ? "text-status-paid" : "text-status-overdue"}`}
        >
          Weights add up to {defaultTotal}%
        </p>
      </div>

      <details
        open={showSubjects}
        onToggle={(e) => setShowSubjects((e.target as HTMLDetailsElement).open)}
        className="rounded-2xl border border-ink/10 bg-white p-3"
      >
        <summary className="min-h-11 cursor-pointer content-center font-semibold text-teal">
          Different weights for some subjects
        </summary>
        <p className="text-sm text-ink/70">
          Leave a box empty to use the weight above. 0 means the assessment doesn&apos;t count for
          that subject.
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {subjects.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-1 gap-2 border-t border-ink/5 pt-2 sm:grid-cols-[12rem_1fr_6rem] sm:items-center"
            >
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="flex flex-wrap gap-2">
                {rows.map((r, i) => (
                  <label key={i} className="flex items-center gap-1 text-xs text-ink/70">
                    {r.name || "…"}
                    <input
                      inputMode="numeric"
                      aria-label={`${s.name}: ${r.name} weight`}
                      placeholder={r.weight}
                      value={r.overrides[s.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        const o = { ...r.overrides };
                        if (v === "") delete o[s.id];
                        else o[s.id] = v;
                        set(i, { overrides: o });
                      }}
                      className="h-11 w-16 rounded-lg border border-ink/20 px-2 text-base"
                    />
                  </label>
                ))}
              </span>
              <span
                className={`text-sm font-bold ${totalFor(s.id) === 100 ? "text-status-paid" : "text-status-overdue"}`}
              >
                {totalFor(s.id)}%
              </span>
            </div>
          ))}
        </div>
      </details>

      {bad.length ? (
        <Notice tone="error">
          Every subject&apos;s weights must add up to 100%. Not yet:{" "}
          {bad
            .slice(0, 5)
            .map((s) => `${s.name} ${totalFor(s.id)}%`)
            .join(", ")}
          {bad.length > 5 ? ` and ${bad.length - 5} more` : ""}.
        </Notice>
      ) : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save assessments"}
      </Button>
    </form>
  );
}
