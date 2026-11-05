import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button, ButtonLink, Card, Loading, Shell } from "@/components/ui";
import { listMySchools, requireSchool } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { canSeeMessages } from "@/lib/messaging/service";
import { markNotificationReadAction } from "./fees/actions";
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
  // Row-level security only returns this person's own notifications.
  const notifications = await db(ctx.dbContext).notification.findMany({
    where: { schoolId: ctx.school.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const fees = can("fees.view") || can("fees.collect") || can("fees.setup") || can("fees.reports");
  // Bursars and clerks work mostly in Fees: make it their main button.
  const feesFirst = can("fees.collect") && !can("students.edit");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-semibold tracking-wide text-twig uppercase">{ctx.school.name}</p>
        <h1 className="font-heading text-2xl font-bold text-ink">Hello, {ctx.displayName}</h1>
        <p className="text-ink/70">{ctx.roles.map((r) => r.name).join(", ")}</p>
      </div>

      {notifications.length ? (
        <section aria-label="Notifications" className="flex flex-col gap-2">
          {notifications.map((n) => (
            <Card key={n.id} className="flex flex-col gap-2 border-status-due/40 bg-status-due/5">
              <p className="font-semibold text-ink">{n.title}</p>
              <p className="text-sm text-ink/80">{n.body}</p>
              <div className="flex items-center gap-4 text-sm">
                {n.link ? (
                  <a href={n.link} className="font-semibold text-teal">
                    Open
                  </a>
                ) : null}
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="font-semibold text-ink/60 hover:text-ink">
                    Mark as read
                  </button>
                </form>
              </div>
            </Card>
          ))}
        </section>
      ) : null}

      {fees && feesFirst ? <ButtonLink href="/dashboard/fees">Fees</ButtonLink> : null}
      {can("students.view") || can("students.view.own_streams") ? (
        <ButtonLink href="/dashboard/students" variant={feesFirst ? "secondary" : "primary"}>
          {can("students.view") ? "Students" : "My students"}
        </ButtonLink>
      ) : null}
      {fees && !feesFirst ? (
        <ButtonLink href="/dashboard/fees" variant="secondary">
          Fees
        </ButtonLink>
      ) : null}
      {canSeeMessages(ctx.permissions) ? (
        <ButtonLink href="/dashboard/messages" variant="secondary">
          Messages
        </ButtonLink>
      ) : null}
      {can("staff.view") ? (
        <ButtonLink href="/dashboard/staff" variant="secondary">
          Staff
        </ButtonLink>
      ) : null}
      {can("structure.manage") ? (
        <ButtonLink href="/dashboard/setup" variant="secondary">
          School setup
        </ButtonLink>
      ) : null}
      {!can("students.view") &&
      !can("students.view.own_streams") &&
      !can("staff.view") &&
      !fees &&
      !canSeeMessages(ctx.permissions) ? (
        <Card>
          <p className="text-ink/70">Your tools will appear here as Kiota grows.</p>
        </Card>
      ) : null}

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
