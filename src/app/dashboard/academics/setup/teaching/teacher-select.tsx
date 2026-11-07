"use client";

import { useActionState, useRef } from "react";
import type { FormState } from "@/lib/actions";
import { assignTeacherAction } from "../../actions";

/** Pick a subject's teacher in a stream; saves as soon as it changes. */
export function TeacherSelect({
  streamId,
  subjectId,
  subject,
  stream,
  value,
  teachers,
}: {
  streamId: string;
  subjectId: string;
  subject: string;
  stream: string;
  value: string | null;
  teachers: { id: string; displayName: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(assignTeacherAction, {});
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      action={action}
      className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[12rem_1fr]"
    >
      <input type="hidden" name="streamId" value={streamId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <label htmlFor={`t-${streamId}-${subjectId}`} className="text-sm font-semibold">
        {subject}
      </label>
      <span className="flex min-w-0 items-center gap-2">
        <select
          id={`t-${streamId}-${subjectId}`}
          name="membershipId"
          aria-label={`${stream} ${subject}: teacher`}
          defaultValue={value ?? ""}
          onChange={() => form.current?.requestSubmit()}
          className="h-11 w-full min-w-0 rounded-xl border border-ink/20 bg-white px-3 text-base"
        >
          <option value="">Not taught here</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <span role="status" className="w-14 shrink-0 text-xs font-semibold text-status-paid">
          {pending ? "Saving…" : state.ok ? "Saved" : ""}
        </span>
      </span>
      {state.error ? (
        <p className="text-sm text-status-overdue sm:col-start-2">{state.error}</p>
      ) : null}
    </form>
  );
}
