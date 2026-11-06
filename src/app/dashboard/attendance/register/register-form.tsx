"use client";

import { useActionState, useMemo, useState } from "react";
import { Notice } from "@/components/ui";
import type { FormState } from "@/lib/actions";
import { type MarkStatus, type TapStatus, STATUS_LABEL, nextStatus } from "@/lib/attendance/rules";
import { submitRegisterAction } from "../actions";

type Row = {
  studentId: string;
  name: string;
  admissionNumber: string;
  boarder: boolean;
  status: MarkStatus;
  locked: boolean;
};

const TONE: Record<MarkStatus, string> = {
  present: "border-ink/10 bg-white",
  absent: "border-status-overdue bg-status-overdue/10",
  late: "border-status-due bg-status-due/15",
  on_leave: "border-egg-blue bg-egg-blue/25",
};

const PILL: Record<MarkStatus, string> = {
  present: "bg-status-paid/15 text-status-paid",
  absent: "bg-status-overdue text-white",
  late: "bg-status-due text-ink",
  on_leave: "bg-egg-blue text-ink",
};

/**
 * The register: everyone starts Present; tap a name to cycle Absent → Late → Present. One
 * "Submit register" button. Students on leave are locked. Big rows for thumbs, one column on a
 * phone, two on a tablet, three on a laptop.
 */
export function RegisterForm({
  streamId,
  sessionId,
  date,
  rows,
  editable,
  submitted,
}: {
  streamId: string;
  sessionId: string;
  date: string;
  rows: Row[];
  editable: boolean;
  submitted: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitRegisterAction, {});
  const [marks, setMarks] = useState<Record<string, MarkStatus>>(() =>
    Object.fromEntries(rows.map((r) => [r.studentId, r.status])),
  );
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, on_leave: 0 };
    for (const v of Object.values(marks)) c[v]++;
    return c;
  }, [marks]);

  const tap = (r: Row) => {
    if (!editable || r.locked) return;
    setMarks((m) => ({ ...m, [r.studentId]: nextStatus(m[r.studentId] as TapStatus) }));
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="streamId" value={streamId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="date" value={date} />
      {Object.entries(marks).map(([id, s]) =>
        s === "absent" || s === "late" ? (
          <input key={id} type="hidden" name={s} value={id} />
        ) : null,
      )}

      {editable ? (
        <p className="text-sm text-ink/70">
          Everyone starts as <strong>Present</strong>. Tap a name to mark <strong>Absent</strong>,
          tap again for <strong>Late</strong>, again for Present.
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Students">
        {rows.map((r) => {
          const s = marks[r.studentId];
          return (
            <li key={r.studentId}>
              <button
                type="button"
                onClick={() => tap(r)}
                disabled={!editable || r.locked}
                aria-label={`${r.name}: ${STATUS_LABEL[s]}`}
                data-status={s}
                className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-2 text-left transition-colors disabled:cursor-default ${TONE[s]} ${editable && !r.locked ? "active:scale-[0.99]" : ""}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-ink">{r.name}</span>
                  <span className="text-xs text-ink/60">
                    {r.admissionNumber} · {r.boarder ? "Boarder" : "Day"}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${PILL[s]}`}>
                  {STATUS_LABEL[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      {editable ? (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
          <p
            className="text-sm font-semibold text-ink"
            aria-live="polite"
            data-testid="register-counts"
          >
            {counts.present} present · {counts.absent} absent · {counts.late} late
            {counts.on_leave ? ` · ${counts.on_leave} on leave` : ""}
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-teal px-6 font-semibold text-white hover:bg-teal/90 disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Submitting…" : submitted ? "Save corrections" : "Submit register"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
