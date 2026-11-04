import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button, ButtonLink, Card, Loading, Shell } from "@/components/ui";
import { requireSchool } from "@/lib/auth/context";
import { listMySchools } from "@/lib/auth/context";
import { supportAccessAction } from "./actions";

export const metadata: Metadata = { title: "Dashboard · Kiota" };

export default function DashboardPage() {
  return (
    <Shell aside={<SignOutButton />}>
      <Suspense fallback={<Loading />}>
        <Dashboard />
      </Suspense>
    </Shell>
  );
}

async function Dashboard() {
  const ctx = await requireSchool();
  const schools = await listMySchools(ctx.user.id);
  const can = (k: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(k);
  const supportOn = ctx.school.supportAccessUntil && ctx.school.supportAccessUntil > new Date();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-semibold tracking-wide text-twig uppercase">{ctx.school.name}</p>
        <h1 className="font-heading text-2xl font-bold text-ink">Hello, {ctx.user.name}</h1>
        <p className="text-ink/70">{ctx.roles.map((r) => r.name).join(", ")}</p>
      </div>

      {can("staff.view") ? (
        <ButtonLink href="/dashboard/staff">Staff</ButtonLink>
      ) : (
        <Card>
          <p className="text-ink/70">Your tools will appear here as Kiota grows.</p>
        </Card>
      )}

      {can("school.settings.manage") ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold">Arend Studio support access</h2>
          <p className="text-sm text-ink/70">
            {supportOn
              ? `On until ${ctx.school.supportAccessUntil!.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}. Arend Studio can see your school's records to help you.`
              : "Off. Arend Studio cannot see your school's records. Turn it on only when you ask us for help."}
          </p>
          <form action={supportAccessAction}>
            <input type="hidden" name="on" value={supportOn ? "0" : "1"} />
            <Button type="submit" variant="secondary">
              {supportOn ? "Turn off support access" : "Turn on for 24 hours"}
            </Button>
          </form>
        </Card>
      ) : null}

      {schools.length > 1 ? (
        <ButtonLink href="/schools" variant="secondary">
          Switch school
        </ButtonLink>
      ) : null}
    </div>
  );
}
