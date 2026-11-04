"use client";

import { useActionState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { signInAction, type SignInState } from "./actions";

const initial: SignInState = { step: "phone" };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);

  if (state.step === "code" && state.phone) {
    return (
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="phone" value={state.phone} />
        <p className="text-ink/80">
          Enter the code sent to <strong>{formatPhone(state.phone)}</strong>.
        </p>
        {state.message && !state.error ? <Notice tone="success">{state.message}</Notice> : null}
        <Field
          label="6-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          required
          error={state.error}
        />
        <Button type="submit" name="intent" value="verify" disabled={pending}>
          {pending ? "Checking…" : "Sign in"}
        </Button>
        <Button type="submit" name="intent" value="resend" variant="secondary" disabled={pending}>
          Send a new code
        </Button>
        <a href="/sign-in" className="text-center text-sm font-semibold text-teal">
          Use a different number
        </a>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Phone number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0712 345 678"
        defaultValue={state.phone ? formatPhone(state.phone) : undefined}
        autoFocus
        required
        error={state.error}
        hint="We'll send you a code by SMS. No password needed."
      />
      <Button type="submit" name="intent" value="send" disabled={pending}>
        {pending ? "Sending…" : "Send code"}
      </Button>
    </form>
  );
}
