import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Loading, Shell } from "@/components/ui";
import { actorFor } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { canUseGate } from "@/lib/leaveout/gate";
import { GateApp } from "./gate-app";

export const metadata: Metadata = { title: "Gate · Kiota" };
export const viewport: Viewport = { themeColor: "#1F5F63" };

export default function GatePage() {
  return (
    <Shell aside={<SignOutButton />}>
      <Suspense fallback={<Loading />}>
        <Gate />
      </Suspense>
    </Shell>
  );
}

async function Gate() {
  const ctx = await requireSchool();
  if (!canUseGate(await actorFor(ctx))) redirect("/dashboard");
  return <GateApp schoolName={ctx.school.name} />;
}
