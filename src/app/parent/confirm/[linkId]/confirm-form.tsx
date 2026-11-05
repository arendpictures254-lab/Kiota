"use client";

import { useActionState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { confirmLinkAction, type ConfirmState } from "../../actions";

export function ConfirmForm({
  linkId,
  text,
}: {
  linkId: string;
  text: Record<"send" | "sent" | "code" | "confirm" | "checking" | "sending" | "resend", string>;
}) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmLinkAction, {
    step: "start",
  });

  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="linkId" value={linkId} />
        {!state.error ? <Notice tone="success">{text.sent}</Notice> : null}
        <Field
          label={text.code}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          required
          error={state.error}
        />
        <Button type="submit" name="intent" value="confirm" disabled={pending}>
          {pending ? text.checking : text.confirm}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="send"
          variant="secondary"
          disabled={pending}
          formNoValidate
        >
          {text.resend}
        </Button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="linkId" value={linkId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button type="submit" name="intent" value="send" disabled={pending}>
        {pending ? text.sending : text.send}
      </Button>
    </form>
  );
}
