import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type PageWidth } from "@/components/app-shell";
import { canSeeAcademics } from "@/lib/academics/setup";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";

export function AcademicsShell({
  title,
  back = { href: "/dashboard/academics", label: "Academics" },
  width = "wide",
  actions,
  children,
}: {
  title?: string;
  back?: { href: string; label: string };
  width?: PageWidth;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell title={title} back={back} width={width} actions={actions}>
      {children}
    </AppShell>
  );
}

export async function loadAcademicsActor() {
  const ctx = await requireSchool();
  if (!canSeeAcademics(ctx.permissions)) redirect("/dashboard");
  return { ctx, actor: await actorFor(ctx) };
}

export const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export const STATUS_TONE: Record<string, string> = {
  draft: "bg-egg-blue/50 text-ink",
  signed_off: "bg-status-due text-ink",
  approved: "bg-status-paid/15 text-status-paid",
  released: "bg-status-paid text-white",
};

/** Term links (a short list: no dropdown needed on a phone). */
export function TermPicker({
  terms,
  current,
  href,
}: {
  terms: { id: string; label: string }[];
  current: string | null;
  href: (termId: string) => string;
}) {
  if (terms.length < 2) return null;
  return (
    <nav aria-label="Term" className="flex flex-wrap gap-2">
      {terms.slice(-6).map((t) => (
        <Link
          key={t.id}
          href={href(t.id)}
          aria-current={t.id === current ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold text-ink aria-[current=page]:border-teal aria-[current=page]:bg-teal aria-[current=page]:text-white"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
