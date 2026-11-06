"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/actions";
import { Button, Notice } from "./ui";

/**
 * A form wired to a server action that returns FormState. Shows the error or success message
 * above the button. Keep one primary action per screen; secondary forms use variant="secondary".
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  children,
  className,
  wide,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
  /** Full-width button. Forms given their own className (small inline forms) get it anyway. */
  wide?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-4"}>
      {children}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Button type="submit" variant={variant} disabled={pending} wide={wide ?? !!className}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
