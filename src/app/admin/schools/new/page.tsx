import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { CreateSchoolForm } from "./create-school-form";

export const metadata: Metadata = { title: "Create a school · Kiota" };

export default function NewSchoolPage() {
  return (
    <AppShell
      title="Create a school"
      back={{ href: "/admin", label: "Schools" }}
      width="form"
      nav="admin"
    >
      <Suspense fallback={<Loading />}>
        <Guarded />
      </Suspense>
    </AppShell>
  );
}

async function Guarded() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  const templates = await db({ userId: user.id, schoolId: null }).levelTemplate.findMany({
    orderBy: { sortOrder: "asc" },
  });
  const levels = templates.map((t) => ({
    key: t.key,
    label: `${t.name} (${t.grades[0]}–${t.grades[t.grades.length - 1]})`,
  }));
  return <CreateSchoolForm levels={levels} />;
}
