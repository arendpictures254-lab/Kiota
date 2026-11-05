"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { payAction, type PayState } from "../../actions";

export function PayForm({
  linkId,
  defaultAmount,
  defaultPhone,
  text,
}: {
  linkId: string;
  defaultAmount: string;
  defaultPhone: string;
  text: Record<
    | "pay.amount"
    | "pay.phone"
    | "pay.phoneHint"
    | "pay.send"
    | "pay.sending"
    | "amountHint"
    | "paysTo",
    string
  >;
}) {
  const [state, action, pending] = useActionState<PayState, FormData>(payAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="linkId" value={linkId} />
      <Field
        label={text["pay.amount"]}
        name="amount"
        inputMode="numeric"
        required
        defaultValue={defaultAmount}
        hint={text.amountHint || undefined}
        error={state.field === "amount" ? state.error : undefined}
      />
      <Field
        label={text["pay.phone"]}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        defaultValue={defaultPhone}
        hint={text["pay.phoneHint"]}
        error={state.field === "phone" ? state.error : undefined}
      />
      {state.error && !state.field ? (
        <p role="alert" className="rounded-xl bg-status-overdue/10 p-3 text-sm text-status-overdue">
          {state.error}
        </p>
      ) : null}
      <p className="text-sm text-ink/60">{text.paysTo}</p>
      <Button type="submit" disabled={pending}>
        {pending ? text["pay.sending"] : text["pay.send"]}
      </Button>
    </form>
  );
}
