import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type PageWidth } from "@/components/app-shell";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canSeeKitchen, canSeeStores } from "@/lib/stores/service";

export function StoresShell({
  title,
  back = { href: "/dashboard/stores", label: "Stores" },
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

/** Stores pages: anyone with a stores permission. The cook only gets the kitchen screen. */
export async function loadStoresActor(opts: { kitchen?: boolean } = {}) {
  const ctx = await requireSchool();
  const p = ctx.permissions;
  if (!canSeeStores(p)) {
    if (canSeeKitchen(p) && !opts.kitchen) redirect("/dashboard/stores/kitchen");
    if (!canSeeKitchen(p)) redirect("/dashboard");
  }
  return { ctx, actor: await actorFor(ctx) };
}

export const KIND_TONE: Record<string, string> = {
  receive: "text-status-paid",
  transfer_in: "text-status-paid",
  uniform_return: "text-status-paid",
  adjust: "text-status-due",
  stocktake: "text-status-due",
};
