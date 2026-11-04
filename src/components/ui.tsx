/**
 * Small, plain building blocks. Mobile first: big touch targets, one primary action per screen.
 */
import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-teal text-white hover:bg-teal/90 disabled:bg-teal/50",
  secondary: "border border-teal/30 bg-white text-teal hover:bg-egg-blue/30",
  danger: "border border-status-overdue/40 bg-white text-status-overdue hover:bg-status-overdue/5",
};

const base =
  "inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  ...input
}: ComponentProps<"input"> & { label: string; hint?: string; error?: string }) {
  const id = input.id ?? input.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="h-12 rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30 aria-invalid:border-status-overdue"
        {...input}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-ink/60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-status-overdue" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  "rounded-xl border border-ink/20 bg-white px-4 text-base text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/30";

export function Select({
  label,
  options,
  placeholder,
  ...select
}: ComponentProps<"select"> & {
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const id = select.id ?? select.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select id={id} className={`h-12 ${control}`} {...select}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextArea({
  label,
  hint,
  ...area
}: ComponentProps<"textarea"> & { label: string; hint?: string }) {
  const id = area.id ?? area.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea id={id} rows={3} className={`py-3 ${control}`} {...area} />
      {hint ? <p className="text-sm text-ink/60">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  ...input
}: ComponentProps<"input"> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-white p-3 has-checked:border-teal has-checked:bg-egg-blue/20">
      <input type="checkbox" className="mt-1 size-5 accent-teal" {...input} />
      <span className="flex flex-col">
        <span className="font-semibold text-ink">{label}</span>
        {description ? <span className="text-sm text-ink/60">{description}</span> : null}
      </span>
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-ink/10 bg-white p-5 ${className}`}>{children}</div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-egg-blue/30 text-ink",
    error: "bg-status-overdue/10 text-status-overdue",
    success: "bg-status-paid/10 text-status-paid",
  };
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl p-3 text-sm ${tones[tone]}`}
    >
      {children}
    </p>
  );
}

/** Page frame: logo bar and a single centred column. */
export function Shell({
  children,
  title,
  back,
  aside,
}: {
  children: ReactNode;
  title?: string;
  back?: { href: string; label: string };
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-ink/10 bg-cream">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/kiota-icon.svg" alt="" width={28} height={28} />
            <span className="font-heading text-lg font-bold text-teal">Kiota</span>
          </Link>
          {aside}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
        {back ? (
          <Link href={back.href} className="text-sm font-semibold text-teal">
            ← {back.label}
          </Link>
        ) : null}
        {title ? <h1 className="font-heading text-2xl font-bold text-ink">{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-ink/60" role="status">
      Loading…
    </div>
  );
}
