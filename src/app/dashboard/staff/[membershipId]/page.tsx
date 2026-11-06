import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, Loading, Notice } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";
import { canGrant } from "@/lib/auth/permissions";
import { platformDb } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { getStaffMember } from "@/lib/staff/service";
import { RoleOptions } from "../role-options";
import { LeaveoutForm, RolesForm } from "./member-forms";

export const metadata: Metadata = { title: "Staff member · Kiota" };

export default function MemberPage({
  params,
  searchParams,
}: PageProps<"/dashboard/staff/[membershipId]">) {
  return (
    <AppShell back={{ href: "/dashboard/staff", label: "Staff" }} width="form">
      <Suspense fallback={<Loading />}>
        <Member params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Member({
  params,
  searchParams,
}: Pick<PageProps<"/dashboard/staff/[membershipId]">, "params" | "searchParams">) {
  const { membershipId } = await params;
  const { invited } = await searchParams;
  const ctx = await requireSchool();
  if (!ctx.permissions.has("staff.view")) redirect("/dashboard");

  const member = /^[0-9a-f-]{36}$/i.test(membershipId)
    ? await getStaffMember(
        { db: platformDb },
        { userId: ctx.user.id, schoolId: ctx.school.id, permissions: ctx.permissions },
        membershipId,
      )
    : null;
  if (!member) notFound();

  const canManage = ctx.permissions.has("staff.manage");
  const mayGrant = canGrant(ctx.permissions, "leaveout.approve");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-title font-bold text-ink">{member.name}</h1>
        <p className="text-ink/70">
          {member.roles.map((r) => r.name).join(", ")} · {formatPhone(member.phone)}
        </p>
      </div>

      {invited ? (
        <Notice tone="success">Invited. They can now sign in with their phone number.</Notice>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">Leave-out approval</h2>
        {member.leaveoutFromRole ? (
          <p className="text-sm text-ink/70">Directors can always approve leave-outs.</p>
        ) : (
          <>
            <p className="text-sm text-ink/70">
              {member.canApproveLeaveouts
                ? "Can approve leave-outs. You can withdraw this at any time."
                : "Cannot approve leave-outs."}
            </p>
            {mayGrant ? (
              <LeaveoutForm
                membershipId={member.membershipId}
                allowed={member.canApproveLeaveouts}
              />
            ) : null}
          </>
        )}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-section font-bold">Roles</h2>
          <RolesForm
            membershipId={member.membershipId}
            roleOptions={<RoleOptions selected={member.roles.map((r) => r.key)} hideLegend />}
          />
        </Card>
      ) : null}
    </div>
  );
}
