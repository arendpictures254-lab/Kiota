import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ButtonLink, Loading, Shell } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { listStaff } from "@/lib/staff/service";

export const metadata: Metadata = { title: "Staff · Kiota" };

export default function StaffPage() {
  return (
    <Shell
      title="Staff"
      back={{ href: "/dashboard", label: "Dashboard" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <StaffList />
      </Suspense>
    </Shell>
  );
}

async function StaffList() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("staff.view")) redirect("/dashboard");
  const staff = await listStaff(
    { db: platformDb },
    { userId: ctx.user.id, schoolId: ctx.school.id, permissions: ctx.permissions },
  );

  return (
    <div className="flex flex-col gap-4">
      {ctx.permissions.has("staff.manage") ? (
        <ButtonLink href="/dashboard/staff/invite">Invite staff</ButtonLink>
      ) : null}
      <ul className="flex flex-col gap-2">
        {staff.map((s) => (
          <li key={s.membershipId}>
            <Link
              href={`/dashboard/staff/${s.membershipId}`}
              className="flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
            >
              <span className="font-semibold text-ink">{s.name}</span>
              <span className="text-sm text-ink/60">
                {s.roles.map((r) => r.name).join(", ")} · {formatPhone(s.phone)}
              </span>
              {s.canApproveLeaveouts ? (
                <span className="mt-1 text-sm font-semibold text-status-paid">
                  Can approve leave-outs
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
