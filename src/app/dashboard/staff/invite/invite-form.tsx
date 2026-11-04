"use client";

import { useActionState, type ReactNode } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { inviteStaffAction, type FormState } from "../actions";

export function InviteForm({ roleOptions }: { roleOptions: ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(inviteStaffAction, {});
  const errorFor = (field: string) => (state.field === field ? state.error : undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && !["name", "phone"].includes(state.field ?? "") ? (
        <Notice tone="error">{state.error}</Notice>
      ) : null}
      <Field label="Full name" name="name" autoComplete="off" required error={errorFor("name")} />
      <Field
        label="Phone number"
        name="phone"
        type="tel"
        inputMode="tel"
        placeholder="0712 345 678"
        required
        error={errorFor("phone")}
        hint="They will sign in with this number."
      />
      {roleOptions}
      <Button type="submit" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
    </form>
  );
}
