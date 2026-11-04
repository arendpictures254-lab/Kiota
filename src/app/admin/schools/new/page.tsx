import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Loading, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { CreateSchoolForm } from "./create-school-form";

export const metadata: Metadata = { title: "Create a school · Kiota" };

export default function NewSchoolPage() {
  return (
    <Shell
      title="Create a school"
      back={{ href: "/admin", label: "Schools" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <Guarded />
      </Suspense>
    </Shell>
  );
}

async function Guarded() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  return <CreateSchoolForm />;
}
