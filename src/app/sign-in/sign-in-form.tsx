"use client";

import { useActionState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n/en";
import { formatPhone } from "@/lib/phone";
import { signInAction, type SignInState } from "./actions";

const initial: SignInState = { step: "phone" };

type Text = Record<
  Extract<
    MessageKey,
    | "signin.phone"
    | "signin.phoneHint"
    | "signin.send"
    | "signin.sending"
    | "signin.enterCode"
    | "signin.code"
    | "signin.signIn"
    | "signin.checking"
    | "signin.resend"
    | "signin.otherNumber"
  >,
  string
>;

export function SignInForm({ text }: { text: Text }) {
  const [state, action, pending] = useActionState(signInAction, initial);

  if (state.step === "code" && state.phone) {
    const [before, after] = text["signin.enterCode"].split("{phone}");
    return (
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="phone" value={state.phone} />
        <p className="text-ink/80">
          {before}
          <strong>{formatPhone(state.phone)}</strong>
          {after}
        </p>
        {state.message && !state.error ? <Notice tone="success">{state.message}</Notice> : null}
        <Field
          label={text["signin.code"]}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          required
          error={state.error}
        />
        <Button wide type="submit" name="intent" value="verify" disabled={pending}>
          {pending ? text["signin.checking"] : text["signin.signIn"]}
        </Button>
        <Button
          wide
          type="submit"
          name="intent"
          value="resend"
          variant="secondary"
          disabled={pending}
        >
          {text["signin.resend"]}
        </Button>
        <a href="/sign-in" className="text-center text-sm font-semibold text-teal">
          {text["signin.otherNumber"]}
        </a>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label={text["signin.phone"]}
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0712 345 678"
        defaultValue={state.phone ? formatPhone(state.phone) : undefined}
        autoFocus
        required
        error={state.error}
        hint={text["signin.phoneHint"]}
      />
      <Button wide type="submit" name="intent" value="send" disabled={pending}>
        {pending ? text["signin.sending"] : text["signin.send"]}
      </Button>
    </form>
  );
}
