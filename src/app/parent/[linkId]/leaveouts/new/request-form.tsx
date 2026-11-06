"use client";

import { useActionState, useState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { parentRequestAction, type RequestState } from "../actions";

type Keys =
  | "lo.reason"
  | "lo.details"
  | "lo.leaves"
  | "lo.back"
  | "lo.who"
  | "lo.someoneElse"
  | "lo.otherName"
  | "lo.otherPhone"
  | "lo.otherHint"
  | "lo.send"
  | "lo.sending"
  | "otherRelationship";

const control =
  "h-12 rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

export function ParentRequestForm({
  linkId,
  reasons,
  collectors,
  defaultLeave,
  defaultReturn,
  text,
}: {
  linkId: string;
  reasons: { id: string; name: string }[];
  collectors: { id: string; label: string }[];
  defaultLeave: string;
  defaultReturn: string;
  text: Record<Keys, string>;
}) {
  const [state, action, pending] = useActionState<RequestState, FormData>(parentRequestAction, {});
  const [who, setWho] = useState(collectors[0] ? `link:${collectors[0].id}` : "other");
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="linkId" value={linkId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reasonId" className="text-sm font-semibold">
          {text["lo.reason"]}
        </label>
        <select
          id="reasonId"
          name="reasonId"
          required
          defaultValue={reasons[0]?.id}
          className={control}
        >
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <Field label={text["lo.details"]} name="details" maxLength={300} />
      <Field
        label={text["lo.leaves"]}
        name="leaveAt"
        type="datetime-local"
        required
        defaultValue={defaultLeave}
      />
      <Field
        label={text["lo.back"]}
        name="returnAt"
        type="datetime-local"
        required
        defaultValue={defaultReturn}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{text["lo.who"]}</legend>
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
            {c.label}
          </label>
        ))}
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-ink/10 bg-white px-4">
          <input
            type="radio"
            name="collector"
            value="other"
            checked={who === "other"}
            onChange={() => setWho("other")}
            className="size-5 accent-teal"
          />
          {text["lo.someoneElse"]}
        </label>
      </fieldset>
      {who === "other" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4">
          <Field label={text["lo.otherName"]} name="otherName" required />
          <Field
            label={text["lo.otherPhone"]}
            name="otherPhone"
            type="tel"
            inputMode="tel"
            required
            placeholder="0712 345 678"
          />
          <Field label={text.otherRelationship} name="otherRelationship" required />
          <p className="text-sm text-ink/60">{text["lo.otherHint"]}</p>
        </div>
      ) : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending}>
        {pending ? text["lo.sending"] : text["lo.send"]}
      </Button>
    </form>
  );
}
