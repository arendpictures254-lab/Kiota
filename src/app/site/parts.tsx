import Link from "next/link";
import type { ReactNode } from "react";
import { WHATSAPP_URL } from "@/lib/hosts";

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-5xl px-4 ${className}`}>{children}</div>;
}

export function PageHero({ title, intro }: { title: string; intro: string }) {
  return (
    <Container className="py-12 sm:py-16">
      <h1 className="max-w-3xl font-heading text-4xl font-bold tracking-tight text-teal sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-ink/80">{intro}</p>
    </Container>
  );
}

export function Feature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6">
      <h3 className="font-heading text-lg font-bold text-ink">{title}</h3>
      <div className="mt-2 text-ink/80">{children}</div>
    </div>
  );
}

export function Band({
  title,
  intro,
  children,
  tone = "plain",
}: {
  title: string;
  intro?: string;
  children?: ReactNode;
  tone?: "plain" | "blue";
}) {
  return (
    <section className={tone === "blue" ? "bg-egg-blue/25" : ""}>
      <Container className="py-12">
        <h2 className="font-heading text-2xl font-bold text-ink sm:text-3xl">{title}</h2>
        {intro ? <p className="mt-3 max-w-2xl text-ink/80">{intro}</p> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </Container>
    </section>
  );
}

export function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 rounded-xl bg-white p-4 text-ink">
          <span aria-hidden="true" className="mt-0.5 font-bold text-status-paid">
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function CallToAction() {
  return (
    <section className="bg-teal text-white">
      <Container className="flex flex-col items-start gap-5 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold">
            See Kiota with your own school in mind
          </h2>
          <p className="mt-2 text-white/85">
            A 30-minute demo, in person or online. No obligation.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/demo"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-cream px-6 font-semibold text-teal hover:bg-white"
          >
            Book a demo
          </Link>
          <a
            href={WHATSAPP_URL}
            rel="noopener"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/50 px-6 font-semibold text-white hover:bg-white/10"
          >
            Chat on WhatsApp
          </a>
        </div>
      </Container>
    </section>
  );
}

/** Long-form text (privacy policy, terms). */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <Container className="pb-16">
      <div className="max-w-3xl space-y-4 text-ink/90 [&_h2]:mt-8 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </Container>
  );
}

export function DraftNotice() {
  return (
    <Container>
      <p
        role="note"
        className="mb-8 max-w-3xl rounded-xl border-2 border-status-due bg-status-due/10 p-4 font-semibold text-ink"
      >
        DRAFT — to be reviewed by a lawyer before launch.
      </p>
    </Container>
  );
}
