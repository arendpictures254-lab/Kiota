import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink, Loading, Notice } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { MODULES } from "@/lib/staff/service";
import { setModulesAction } from "./actions";

export const metadata: Metadata = { title: "Arend Studio admin · Kiota" };

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <AppShell title="Schools" width="wide" nav="admin">
      <Suspense fallback={<Loading />}>
        <Schools searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Schools({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  const { created } = await searchParams;

  // RLS lets admins list schools, but never read their data (unless support access is on).
  const schools = await db({ userId: user.id, schoolId: null }).school.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      county: true,
      status: true,
      supportAccessUntil: true,
      modules: true,
    },
  });
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      {created ? (
        <Notice tone="success">School created. We sent the Director an SMS.</Notice>
      ) : null}
      <ButtonLink href="/admin/schools/new">Create a school</ButtonLink>
      <ButtonLink href="/admin/demo-requests" variant="secondary">
        Demo requests
      </ButtonLink>
      <ButtonLink href="/admin/messaging" variant="secondary">
        Messaging wallets and templates
      </ButtonLink>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
        {schools.map((s) => (
          <li key={s.id} className="rounded-2xl border border-ink/10 bg-white p-4">
            <p className="font-semibold text-ink">{s.name}</p>
            <p className="text-sm text-ink/60">
              {s.county} · {s.status}
              {s.supportAccessUntil && s.supportAccessUntil > now ? " · support access on" : ""}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-teal">
                Modules: {s.modules.length ? s.modules.join(", ") : "core only"}
              </summary>
              <form action={setModulesAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="schoolId" value={s.id} />
                {MODULES.map((m) => (
                  <label key={m.key} className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="modules"
                      value={m.key}
                      defaultChecked={s.modules.includes(m.key)}
                      className="size-5 accent-teal"
                    />
                    {m.label}
                  </label>
                ))}
                <button
                  type="submit"
                  className="h-11 rounded-xl border border-teal/30 bg-white px-4 text-sm font-semibold text-teal"
                >
                  Save modules
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
