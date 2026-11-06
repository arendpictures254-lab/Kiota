"use client";

import { useActionState, useState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { requestLeaveoutAction } from "../actions";

const control =
  "h-12 rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

export function RequestForm({
  studentId,
  reasons,
  collectors,
  defaultLeave,
  defaultReturn,
}: {
  studentId: string;
  reasons: { id: string; name: string }[];
  collectors: { id: string; label: string }[];
  defaultLeave: string;
  defaultReturn: string;
}) {
  const [state, action, pending] = useActionState(requestLeaveoutAction, {});
  const [who, setWho] = useState(collectors[0] ? `link:${collectors[0].id}` : "other");
  const err = (f: string) => (state.field === f ? state.error : undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reasonId" className="text-sm font-semibold text-ink">
          Reason
        </label>
        <select id="reasonId" name="reasonId" required defaultValue="" className={control}>
          <option value="" disabled>
            Choose a reason
          </option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Details (optional)"
        name="details"
        maxLength={300}
        placeholder="e.g. dentist in Kilifi town"
      />
      <Field
        label="Leaves"
        name="leaveAt"
        type="datetime-local"
        required
        defaultValue={defaultLeave}
        error={err("leaveAt")}
      />
      <Field
        label="Comes back"
        name="returnAt"
        type="datetime-local"
        required
        defaultValue={defaultReturn}
        error={err("returnAt")}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">Who is collecting</legend>
        {collectors.map((c) => (
          <label
            key={c.id}
            className="flex min-h-12 items-center gap-3 rounded-xl border border-ink/10 bg-white px-4"
          >
            <input
              type="radio"
              name="collector"
              value={`link:${c.id}`}
              checked={who === `link:${c.id}`}
              onChange={() => setWho(`link:${c.id}`)}
              className="size-5 accent-teal"
            />
            <span>{c.label}</span>
          </label>
        ))}
        {collectors.length === 0 ? (
          <p className="text-sm text-ink/60">
            No guardian of this student is marked “authorised to collect”.
          </p>
        ) : null}
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-ink/10 bg-white px-4">
          <input
            type="radio"
            name="collector"
            value="other"
            checked={who === "other"}
            onChange={() => setWho("other")}
            className="size-5 accent-teal"
          />
          <span>Someone else (the parent approves by SMS)</span>
        </label>
        {err("collector") ? <Notice tone="error">{err("collector")}</Notice> : null}
      </fieldset>
      {who === "other" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-status-due/30 bg-status-due/5 p-4">
          <Field label="Collector's name" name="otherName" required error={err("otherName")} />
          <Field
            label="Collector's phone"
            name="otherPhone"
            type="tel"
            inputMode="tel"
            required
            placeholder="0712 345 678"
            error={err("otherPhone")}
          />
          <Field
            label="Relationship to the student"
            name="otherRelationship"
            required
            placeholder="Uncle, driver..."
            error={err("otherRelationship")}
          />
          <p className="text-sm text-ink/70">
            The parents get an SMS naming this person, and reply YES with a code to approve. Only
            then can it be approved.
          </p>
        </div>
      ) : null}
      {state.error &&
      ![
        "leaveAt",
        "returnAt",
        "collector",
        "otherName",
        "otherPhone",
        "otherRelationship",
      ].includes(state.field ?? "") ? (
        <Notice tone="error">{state.error}</Notice>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send for approval"}
      </Button>
    </form>
  );
}
