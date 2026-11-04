"use client";

import { useActionState, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";
import { leaveoutApprovalAction, setRolesAction, type FormState } from "../actions";

export function RolesForm({
  membershipId,
  roleOptions,
}: {
  membershipId: string;
  roleOptions: ReactNode;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(setRolesAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      {roleOptions}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save roles"}
      </Button>
    </form>
  );
}

export function LeaveoutForm({
  membershipId,
  allowed,
}: {
  membershipId: string;
  allowed: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(leaveoutApprovalAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="allow" value={allowed ? "0" : "1"} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      <Button type="submit" variant={allowed ? "danger" : "primary"} disabled={pending}>
        {pending
          ? "Saving…"
          : allowed
            ? "Withdraw leave-out approval"
            : "Allow to approve leave-outs"}
      </Button>
    </form>
  );
}
