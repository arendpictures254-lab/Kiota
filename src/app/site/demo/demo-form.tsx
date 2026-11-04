"use client";

import { useActionState } from "react";
import { Button, Field, Notice, Select, TextArea } from "@/components/ui";
import { requestDemoAction, type DemoState } from "./actions";

const SCHOOL_TYPES = [
  { value: "day", label: "Day school" },
  { value: "boarding", label: "Boarding school" },
  { value: "mixed", label: "Day and boarding" },
];

export function DemoForm({ whatsappUrl }: { whatsappUrl: string }) {
  const [state, action, pending] = useActionState<DemoState, FormData>(requestDemoAction, {});
  const err = (f: string) => (state.field === f ? state.error : undefined);

  if (state.done) {
    return (
      <div
        className="flex flex-col gap-4 rounded-2xl border border-status-paid/30 bg-white p-6"
        role="status"
      >
        <h2 className="font-heading text-2xl font-bold text-teal">Thank you</h2>
        <p className="text-ink/80">
          We have your request and will call you within two working days to arrange the demo.
        </p>
        <a href={whatsappUrl} rel="noopener" className="font-semibold text-teal hover:underline">
          Prefer WhatsApp? Chat with us now →
        </a>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-ink/10 bg-white p-6"
    >
      {state.error && !state.field ? <Notice tone="error">{state.error}</Notice> : null}
      <Field
        label="School name"
        name="schoolName"
        required
        autoComplete="organization"
        error={err("schoolName")}
      />
      <Field label="County" name="county" required error={err("county")} />
      <Field
        label="Your name"
        name="contactName"
        required
        autoComplete="name"
        error={err("contactName")}
      />
      <Field
        label="Your role"
        name="contactRole"
        required
        placeholder="Director, Principal, Bursar…"
        autoComplete="organization-title"
        error={err("contactRole")}
      />
      <Field
        label="Phone"
        name="phone"
        type="tel"
        inputMode="tel"
        required
        autoComplete="tel"
        placeholder="0712 345 678"
        error={err("phone")}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        hint="Optional"
        error={err("email")}
      />
      <Field
        label="Number of students"
        name="studentCount"
        type="number"
        inputMode="numeric"
        min={1}
        required
        error={err("studentCount")}
      />
      <Select
        label="Type of school"
        name="schoolType"
        required
        placeholder="Choose"
        options={SCHOOL_TYPES}
      />
      {err("schoolType") ? <Notice tone="error">{err("schoolType")}</Notice> : null}
      <TextArea
        label="Message"
        name="message"
        hint="Optional. What would you like Kiota to help with? Please don't include any children's details."
      />
      {err("message") ? <Notice tone="error">{err("message")}</Notice> : null}
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Request a demo"}
      </Button>
      <p className="text-sm text-ink/60">
        We use these details only to contact you about Kiota. See our privacy policy.
      </p>
    </form>
  );
}
