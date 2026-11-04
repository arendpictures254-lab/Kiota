import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Shell } from "@/components/ui";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canViewStudents } from "@/lib/students/service";

export async function loadStudentsActor() {
  const ctx = await requireSchool();
  const actor = await actorFor(ctx);
  if (!canViewStudents(actor)) redirect("/dashboard");
  return { ctx, actor };
}

export function StudentsShell({
  title,
  back = { href: "/dashboard/students", label: "Students" },
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

export function isoDay(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function showDate(d: Date | null | undefined) {
  return d
    ? d.toLocaleDateString("en-KE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
}

export function kes(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}KES ${(Math.abs(cents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
