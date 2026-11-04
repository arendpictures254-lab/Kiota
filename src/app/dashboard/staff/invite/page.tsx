import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Loading, Shell } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";
import { RoleOptions } from "../role-options";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invite staff · Kiota" };

export default function InvitePage() {
  return (
    <Shell
      title="Invite staff"
      back={{ href: "/dashboard/staff", label: "Staff" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <Guarded />
      </Suspense>
    </Shell>
  );
}

async function Guarded() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("staff.manage")) redirect("/dashboard/staff");
  return <InviteForm roleOptions={<RoleOptions />} />;
}
