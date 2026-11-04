import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { ButtonLink, Loading, Notice, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Arend Studio admin · Kiota" };

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Shell title="Schools" aside={<SignOutButton />}>
      <Suspense fallback={<Loading />}>
        <Schools searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}

async function Schools({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  const { created } = await searchParams;

  // RLS lets admins list schools, but never read their data (unless support access is on).
  const schools = await db({ userId: user.id, schoolId: null }).school.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, county: true, status: true, supportAccessUntil: true },
  });
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {created ? (
        <Notice tone="success">School created. We sent the Director an SMS.</Notice>
      ) : null}
      <ButtonLink href="/admin/schools/new">Create a school</ButtonLink>
      <ul className="flex flex-col gap-2">
        {schools.map((s) => (
          <li key={s.id} className="rounded-2xl border border-ink/10 bg-white p-4">
            <p className="font-semibold text-ink">{s.name}</p>
            <p className="text-sm text-ink/60">
              {s.county} · {s.status}
              {s.supportAccessUntil && s.supportAccessUntil > now ? " · support access on" : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
