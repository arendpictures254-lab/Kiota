import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Shell } from "@/components/ui";
import { actorFor, deps } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { getStructure } from "@/lib/structure/service";

/** Setup pages need "structure.manage"; others are sent back to the dashboard. */
export async function loadSetup() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("structure.manage")) redirect("/dashboard");
  const actor = await actorFor(ctx);
  return { ctx, actor, structure: await getStructure(deps, actor) };
}

export function SetupShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Shell
      title={title}
      back={{ href: "/dashboard/setup", label: "School setup" }}
      aside={<SignOutButton />}
    >
      {children}
    </Shell>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function fmtDate(d: Date | null) {
  return d
    ? d.toLocaleDateString("en-KE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
}
