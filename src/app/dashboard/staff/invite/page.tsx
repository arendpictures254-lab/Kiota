import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";
import { RoleOptions } from "../role-options";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite staff · Kiota" };

export default function InvitePage() {
  return (
    <AppShell title="Invite staff" back={{ href: "/dashboard/staff", label: "Staff" }} width="form">
      <Suspense fallback={<Loading />}>
        <Guarded />
      </Suspense>
    </AppShell>
  );
}

async function Guarded() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("staff.manage")) redirect("/dashboard/staff");
  return <InviteForm roleOptions={<RoleOptions />} />;
}
