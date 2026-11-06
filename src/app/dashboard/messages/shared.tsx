import { AppShell, type PageWidth } from "@/components/app-shell";
import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canSeeMessages } from "@/lib/messaging/service";

/** Message pages: anyone who sends, tops up or (as a class teacher) follows their streams. */
export async function loadMessagesActor() {
  const ctx = await requireSchool();
  const actor = await actorFor(ctx);
  if (!canSeeMessages(actor.permissions)) redirect("/dashboard");
  return { ctx, actor };
}

export function MessagesShell({
  title,
  back = { href: "/dashboard/messages", label: "Messages" },
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

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
};

export const STATUS_TONE: Record<string, string> = {
  queued: "bg-ink/5 text-ink/70",
  sending: "bg-ink/5 text-ink/70",
  sent: "bg-egg-blue/40 text-teal",
  delivered: "bg-status-paid/10 text-status-paid",
  failed: "bg-status-overdue/10 text-status-overdue",
};
