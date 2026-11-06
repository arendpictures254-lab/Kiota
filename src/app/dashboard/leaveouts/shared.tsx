import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Shell } from "@/components/ui";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canSeeLeaveouts } from "@/lib/leaveout/service";
import { redirect } from "next/navigation";

export function LeaveoutsShell({
  title,
  back = { href: "/dashboard/leaveouts", label: "Leave-outs" },
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

export async function loadLeaveoutActor() {
  const ctx = await requireSchool();
  if (!canSeeLeaveouts(ctx.permissions))
    redirect(ctx.permissions.has("gate.scan") ? "/gate" : "/dashboard");
  return { ctx, actor: await actorFor(ctx) };
}

export const STATUS_LABEL: Record<string, string> = {
  awaiting_parent: "Waiting for the parent",
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  out: "Out",
  returned: "Back",
};

export const STATUS_TONE: Record<string, string> = {
  awaiting_parent: "bg-status-due/15 text-status-due",
  pending: "bg-status-due/15 text-status-due",
  approved: "bg-teal/10 text-teal",
  declined: "bg-status-overdue/10 text-status-overdue",
  cancelled: "bg-ink/10 text-ink/60",
  out: "bg-egg-blue/40 text-ink",
  returned: "bg-status-paid/10 text-status-paid",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status] ?? ""}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
