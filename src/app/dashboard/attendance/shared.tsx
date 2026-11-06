import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type PageWidth } from "@/components/app-shell";
import { actorFor } from "@/lib/actions";
import { canHandleBoarderAlerts, canTakeAttendance } from "@/lib/attendance/service";
import { canManageStaffAttendance } from "@/lib/attendance/staff";
import { requireSchool } from "@/lib/auth/context";

export function AttendanceShell({
  title,
  back = { href: "/dashboard/attendance", label: "Attendance" },
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

export async function loadAttendanceActor() {
  const ctx = await requireSchool();
  const p = ctx.permissions;
  if (!canTakeAttendance(p) && !canHandleBoarderAlerts(p) && !canManageStaffAttendance(p))
    redirect("/dashboard");
  return { ctx, actor: await actorFor(ctx) };
}

export const MARK_TONE: Record<string, string> = {
  present: "bg-status-paid/10 text-status-paid",
  absent: "bg-status-overdue text-white",
  late: "bg-status-due text-ink",
  on_leave: "bg-egg-blue/50 text-ink",
};

export const DAY_TONE: Record<string, string> = {
  present: "bg-status-paid",
  late: "bg-status-due",
  absent: "bg-status-overdue",
  part: "bg-status-overdue/50",
  on_leave: "bg-egg-blue",
};

/** "07:30" from minutes after midnight. */
export const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const nairobiTime = (d: Date) =>
  d.toLocaleTimeString("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const dayLabel = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
