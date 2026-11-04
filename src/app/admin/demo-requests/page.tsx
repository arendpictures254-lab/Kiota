import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, Loading, Select, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { DEMO_STATUSES, SCHOOL_TYPES, listDemoRequests } from "@/lib/demo/service";
import { formatPhone } from "@/lib/phone";
import { setDemoStatusAction } from "./actions";

export const metadata: Metadata = { title: "Demo requests · Kiota" };

export default function DemoRequestsPage() {
  return (
    <Shell
      title="Demo requests"
      back={{ href: "/admin", label: "Schools" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <Requests />
      </Suspense>
    </Shell>
  );
}

async function Requests() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  const requests = await listDemoRequests(platformDb, { userId: user.id, isPlatformAdmin: true });
  if (requests.length === 0) return <p className="text-ink/70">No demo requests yet.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{r.schoolName}</p>
                <p className="text-sm text-ink/70">
                  {r.county} · {r.studentCount} students ·{" "}
                  {SCHOOL_TYPES.find((t) => t.value === r.schoolType)?.label ?? r.schoolType}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-egg-blue/40 px-3 py-1 text-xs font-semibold text-teal">
                {DEMO_STATUSES.find((s) => s.value === r.status)?.label}
              </span>
            </div>
            <p className="text-sm">
              {r.contactName} ({r.contactRole}) ·{" "}
              <a href={`tel:${r.phone}`} className="font-semibold text-teal">
                {formatPhone(r.phone)}
              </a>
              {r.email ? (
                <>
                  {" "}
                  ·{" "}
                  <a href={`mailto:${r.email}`} className="text-teal">
                    {r.email}
                  </a>
                </>
              ) : null}
            </p>
            {r.message ? (
              <p className="text-sm whitespace-pre-line text-ink/80">{r.message}</p>
            ) : null}
            <p className="text-xs text-ink/50">
              {r.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}
            </p>
            <ActionForm action={setDemoStatusAction} submitLabel="Save status" variant="secondary">
              <input type="hidden" name="id" value={r.id} />
              <Select
                label="Status"
                name="status"
                id={`status-${r.id}`}
                defaultValue={r.status}
                options={[...DEMO_STATUSES]}
              />
            </ActionForm>
          </Card>
        </li>
      ))}
    </ul>
  );
}
