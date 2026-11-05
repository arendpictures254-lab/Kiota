"use client";

import { useActionState, useTransition, type FormEvent, type ReactNode } from "react";
import type { SendState } from "@/lib/messaging/preview-view";
import { Button, Notice } from "./ui";

/**
 * Two steps for every bulk send: "Check cost" shows who gets it, how many SMS units, the total
 * cost and the balance after; only then "Send". The server refuses the send if the cost changed
 * in between. Submits by hand (not <form action>) so the fields keep their values between steps.
 */
export function SendConfirmForm({
  action,
  children,
  checkLabel = "Check cost",
}: {
  action: (state: SendState, form: FormData) => Promise<SendState>;
  children: ReactNode;
  checkLabel?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const [, startTransition] = useTransition();
  const p = state.preview;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(data));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {children}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
      {p ? (
        <section
          aria-label="Cost before sending"
          className="flex flex-col gap-2 rounded-2xl border border-teal/30 bg-egg-blue/20 p-4"
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink/70">Parents</dt>
            <dd className="text-right font-semibold">{p.recipients}</dd>
            <dt className="text-ink/70">Messages</dt>
            <dd className="text-right font-semibold">{p.messagesText}</dd>
            <dt className="text-ink/70">SMS units</dt>
            <dd className="text-right font-semibold">{p.units}</dd>
            <dt className="text-ink/70">Total cost</dt>
            <dd className="text-right font-heading font-bold text-teal">{p.costText}</dd>
            <dt className="text-ink/70">Wallet now</dt>
            <dd className="text-right">{p.balanceText}</dd>
            <dt className="text-ink/70">Balance after</dt>
            <dd
              className={`text-right font-semibold ${p.enough ? "text-status-paid" : "text-status-overdue"}`}
            >
              {p.balanceAfterText}
            </dd>
          </dl>
          {p.note ? <p className="text-sm text-ink/70">{p.note}</p> : null}
          {p.waitsForMorning ? (
            <p className="text-sm text-status-due">
              It is quiet hours (21:00 to 07:00): these messages will go out at 07:00.
            </p>
          ) : null}
          {p.sample ? (
            <p className="rounded-xl bg-white p-3 text-sm text-ink/80">
              <span className="block text-xs font-semibold text-ink/50 uppercase">Example</span>
              {p.sample}
            </p>
          ) : null}
          {!p.enough ? (
            <p className="text-sm font-semibold text-status-overdue">
              Not enough credit. Top up the wallet first.
            </p>
          ) : null}
          <input type="hidden" name="expectedCost" value={p.costCents} />
        </section>
      ) : null}
      {p && p.enough && p.recipients > 0 ? (
        <>
          <Button type="submit" name="step" value="send" disabled={pending}>
            {pending
              ? "Sending…"
              : `Send to ${p.recipients} parent${p.recipients === 1 ? "" : "s"} · ${p.costText}`}
          </Button>
          <Button type="submit" name="step" value="preview" variant="secondary" disabled={pending}>
            Check again
          </Button>
        </>
      ) : (
        <Button type="submit" name="step" value="preview" disabled={pending}>
          {pending ? "Checking…" : checkLabel}
        </Button>
      )}
    </form>
  );
}
