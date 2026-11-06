import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Button, Card, Loading } from "@/components/ui";
import { actorFor, deps } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { dashboardOverview } from "@/lib/dashboard/service";
import { db } from "@/lib/db";
import { kes, receiptNo } from "@/lib/fees/allocation";
import { whenText } from "@/lib/leaveout/rules";
import { canApproveLeaveouts, canRequestLeaveouts } from "@/lib/leaveout/service";
import { canSendNotices } from "@/lib/messaging/service";
import { markNotificationReadAction } from "./fees/actions";
import { supportAccessAction } from "./actions";

export const metadata: Metadata = { title: "Dashboard · Kiota" };

export default function DashboardPage() {
  return (
    <AppShell width="wide">
      <Suspense fallback={<Loading />}>
        <Dashboard />
      </Suspense>
    </AppShell>
  );
}

/** Large amounts written short for the key-number tiles: KES 582.4K, KES 2.1M. */
const short = (cents: number) =>
  Math.abs(cents) >= 10_000_000
    ? `KES ${new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100)}`
    : kes(cents);

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" });

/** A key number at the top of the dashboard. */
function Stat({
  label,
  value,
  sub,
  href,
  tone = "ink",
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  tone?: "ink" | "overdue" | "teal";
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="text-sm font-semibold text-ink/60">{label}</span>
      <span
        className={`truncate font-heading text-[clamp(1.25rem,0.9rem+0.8vw,1.9rem)] leading-tight font-bold whitespace-nowrap ${tone === "overdue" ? "text-status-overdue" : tone === "teal" ? "text-teal" : "text-ink"}`}
      >
        {value}
      </span>
      {sub ? <span className="text-sm text-ink/60">{sub}</span> : null}
      {children}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 lg:p-5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-teal/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A panel of recent things (payments, approvals, notices). */
function Panel({
  title,
  href,
  linkLabel,
  empty,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-2xl border border-ink/10 bg-white"
      aria-label={title}
    >
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-5 py-3">
        <h2 className="font-heading text-section font-bold">{title}</h2>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-teal"
        >
          {linkLabel} →
        </Link>
      </div>
      {children.length ? (
        <ul className="flex flex-col divide-y divide-ink/5">{children}</ul>
      ) : (
        <p className="px-5 py-6 text-ink/60">{empty}</p>
      )}
    </section>
  );
}

const rowLink = "flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-egg-blue/15";

async function Dashboard() {
  const ctx = await requireSchool();
  const can = (k: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(k);
  // A gate guard sees only the gate screens.
  if (
    can("gate.scan") &&
    [...ctx.permissions].every((k) => k === "gate.scan" || k === "school.view")
  )
    redirect("/gate");
  const actor = await actorFor(ctx);
  const supportOn = ctx.school.supportAccessUntil && ctx.school.supportAccessUntil > new Date();
  // Row-level security only returns this person's own notifications.
  const [notifications, o] = await Promise.all([
    db(ctx.dbContext).notification.findMany({
      where: { schoolId: ctx.school.id, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    dashboardOverview(deps, actor),
  ]);

  const collectedPct =
    o.fees && o.fees.expectedCents > 0
      ? Math.min(100, Math.round((o.fees.collectedCents / o.fees.expectedCents) * 100))
      : 0;

  const shortcuts: [string, string, boolean][] = [
    ["/dashboard/fees/pay", "Record a payment", can("fees.collect")],
    ["/dashboard/messages/new", "Send a notice", canSendNotices(ctx.permissions)],
    ["/dashboard/leaveouts/new", "Request a leave-out", canRequestLeaveouts(ctx.permissions)],
    ["/dashboard/students/new", "Add a student", can("students.edit")],
    ["/dashboard/fees/reports", "Fee reports", can("fees.reports")],
    ["/dashboard/staff/invite", "Invite staff", can("staff.manage")],
  ];
  const actions = shortcuts.filter((x) => x[2]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-semibold tracking-wide text-twig uppercase">{ctx.school.name}</p>
        <h1 className="font-heading text-title font-bold text-ink">Hello, {ctx.displayName}</h1>
        <p className="text-ink/70">{ctx.roles.map((r) => r.name).join(", ")}</p>
      </div>

      {/* Key numbers */}
      <section
        aria-label="Key numbers"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 [&>*:first-child]:col-span-2 md:[&>*:first-child]:col-span-1"
      >
        {o.fees ? (
          <Stat
            label={`Collected · ${o.fees.term}`}
            value={short(o.fees.collectedCents)}
            sub={`of ${short(o.fees.expectedCents)} expected (${collectedPct}%)`}
            href="/dashboard/fees/reports"
            tone="teal"
          >
            <span
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-egg-blue/40"
              aria-hidden
            >
              <span
                className="block h-full rounded-full bg-teal"
                style={{ width: `${collectedPct}%` }}
              />
            </span>
          </Stat>
        ) : null}
        {o.studentCount !== null ? (
          <Stat
            label={can("students.view") ? "Students" : "My students"}
            value={o.studentCount.toLocaleString("en-KE")}
            sub="active"
            href="/dashboard/students"
          />
        ) : null}
        {o.staffCount !== null ? (
          <Stat
            label="Staff"
            value={o.staffCount.toLocaleString("en-KE")}
            sub="with Kiota access"
            href="/dashboard/staff"
          />
        ) : null}
        {o.outCount !== null ? (
          <Stat
            label="Out on leave"
            value={String(o.outCount)}
            sub="students out of school now"
            href="/dashboard/leaveouts"
          />
        ) : null}
        {o.wallet !== null ? (
          <Stat
            label="Messaging wallet"
            value={short(o.wallet)}
            sub="SMS and WhatsApp credit"
            href="/dashboard/messages/wallet"
            tone={o.wallet < 0 ? "overdue" : "ink"}
          />
        ) : null}
      </section>

      {/* What is happening: side by side on a computer */}
      {o.payments || o.waiting || o.notices ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {o.payments ? (
            <Panel
              title="Recent payments"
              href="/dashboard/fees/payments"
              linkLabel="All payments"
              empty="No payments yet."
            >
              {o.payments.map((pm) => (
                <li key={pm.id}>
                  <Link
                    href={
                      pm.receipt
                        ? `/dashboard/fees/receipts/${pm.receipt.id}`
                        : "/dashboard/fees/payments"
                    }
                    className={rowLink}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{pm.studentName}</span>
                      <span className="text-sm text-ink/60">
                        {day(pm.paidAt)} · {pm.method === "mpesa" ? "M-Pesa" : pm.method}
                        {pm.receipt ? ` · No. ${receiptNo(pm.receipt.number)}` : ""}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${pm.reversal ? "text-ink/40 line-through" : ""}`}
                    >
                      {kes(pm.amountCents)}
                    </span>
                  </Link>
                </li>
              ))}
            </Panel>
          ) : null}
          {o.waiting ? (
            <Panel
              title={
                canApproveLeaveouts(ctx.permissions)
                  ? "Waiting for your approval"
                  : "Leave-outs waiting"
              }
              href="/dashboard/leaveouts"
              linkLabel="Leave-outs"
              empty="Nothing waiting."
            >
              {o.waiting.map((l) => (
                <li key={l.id}>
                  <Link href={`/dashboard/leaveouts/${l.id}`} className={rowLink}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{l.studentName}</span>
                      <span className="truncate text-sm text-ink/60">
                        {l.classLabel} · {l.reason}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm text-ink/70">
                      {whenText(l.leaveAt)}
                      {l.status === "awaiting_parent" ? (
                        <span className="block text-status-due">Parent to confirm</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </Panel>
          ) : null}
          {o.notices ? (
            <Panel
              title="Recent notices"
              href="/dashboard/messages"
              linkLabel="Messages"
              empty="No notices sent yet."
            >
              {o.notices.map((n) => (
                <li key={n.id}>
                  <Link href={`/dashboard/messages/log?campaign=${n.id}`} className={rowLink}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">{n.title}</span>
                      <span className="text-sm text-ink/60">{day(n.createdAt)}</span>
                    </span>
                    <span className="shrink-0 text-sm text-ink/70">
                      Read {n.reads}/{n.recipients}
                    </span>
                  </Link>
                </li>
              ))}
            </Panel>
          ) : null}
        </div>
      ) : null}

      {notifications.length ? (
        <section aria-label="Notifications" className="flex flex-col gap-2">
          <h2 className="font-heading text-section font-bold">For you</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {notifications.map((n) => (
              <Card key={n.id} className="flex flex-col gap-2 border-status-due/40 bg-status-due/5">
                <p className="font-semibold text-ink">{n.title}</p>
                <p className="text-sm text-ink/80">{n.body}</p>
                <div className="flex items-center gap-4 text-sm">
                  {n.link ? (
                    <a
                      href={n.link}
                      className="inline-flex min-h-11 items-center font-semibold text-teal"
                    >
                      Open
                    </a>
                  ) : null}
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button
                      type="submit"
                      className="min-h-11 font-semibold text-ink/60 hover:text-ink"
                    >
                      Mark as read
                    </button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {actions.length ? (
        <section aria-label="Shortcuts" className="flex flex-col gap-2">
          <h2 className="font-heading text-section font-bold">Shortcuts</h2>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {actions.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-14 items-center rounded-2xl border border-teal/30 bg-white px-4 font-semibold text-teal hover:bg-egg-blue/20"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {!o.fees &&
      o.studentCount === null &&
      o.staffCount === null &&
      !o.payments &&
      !o.waiting &&
      !o.notices ? (
        <Card>
          <p className="text-ink/70">Your tools will appear here as Kiota grows.</p>
        </Card>
      ) : null}

      {can("school.settings.manage") ? (
        <Card className="flex max-w-3xl flex-col gap-3">
          <h2 className="font-heading text-section font-bold">Arend Studio support access</h2>
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
    </div>
  );
}
