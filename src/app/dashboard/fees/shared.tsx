import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Shell } from "@/components/ui";
import { actorFor } from "@/lib/actions";
import type { PermissionKey } from "@/lib/auth/catalog";
import { requireSchool } from "@/lib/auth/context";

/** Fee pages: the user needs at least one of `perms`, otherwise back to the dashboard. */
export async function loadFeesActor(...perms: PermissionKey[]) {
  const ctx = await requireSchool();
  const actor = await actorFor(ctx);
  const needed = perms.length
    ? perms
    : (["fees.view", "fees.collect", "fees.setup", "fees.reports"] as PermissionKey[]);
  if (!needed.some((p) => actor.permissions.has(p))) redirect("/dashboard");
  return { ctx, actor };
}

export function FeesShell({
  title,
  back = { href: "/dashboard/fees", label: "Fees" },
  children,
}: {
  title?: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <Shell title={title} back={back} aside={<SignOutButton />}>
      {children}
    </Shell>
  );
}

export const nairobi = (d: Date) =>
  d.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const nairobiDay = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
/** Midnight today, Nairobi time. */
export const startOfTodayNairobi = () =>
  new Date(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10) + "T00:00:00+03:00");
export const todayIso = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
