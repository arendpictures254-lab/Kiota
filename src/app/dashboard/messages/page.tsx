import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { canSendNotices, noticeReadCounts } from "@/lib/messaging/service";
import { walletOverview } from "@/lib/messaging/wallet";
import { MessagesShell, loadMessagesActor } from "./shared";

export const metadata: Metadata = { title: "Messages · Kiota" };

export default function MessagesPage() {
  return (
    <MessagesShell title="Messages" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Hub />
      </Suspense>
    </MessagesShell>
  );
}

async function Hub() {
  const { actor } = await loadMessagesActor();
  const w = await walletOverview(deps, actor);
  const low = w.balanceCents < w.lowBalanceThresholdCents;
  const notices = w.campaigns.filter((c) => c.kind === "notice").slice(0, 5);
  const reads = await noticeReadCounts(
    deps,
    actor,
    notices.map((n) => n.id),
  );
  const links: [string, string, string, boolean][] = [
    [
      "/dashboard/messages/log",
      "Message history",
      "Every SMS and WhatsApp, with its status and cost",
      true,
    ],
    ["/dashboard/messages/wallet", "Wallet", "Top up, usage per month, cost per message", true],
    [
      "/dashboard/messages/invite",
      "Invite parents to Kiota",
      "Send the sign-in invitation, and see who has signed in",
      canSendNotices(actor.permissions),
    ],
    [
      "/dashboard/fees/reports?view=defaulters",
      "Fee reminders",
      "From the defaulters list",
      actor.permissions.has("fees.reports"),
    ],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card className={low ? "border-status-due/50 bg-status-due/5" : ""}>
        <p className="text-sm text-ink/70">Messaging wallet</p>
        <p
          className={`font-heading text-display font-bold ${w.balanceCents < 0 ? "text-status-overdue" : "text-teal"}`}
        >
          {kes(w.balanceCents)}
        </p>
        <p className="text-sm text-ink/60">
          {kes(w.prices.smsUnitPriceCents)} per SMS · {kes(w.prices.whatsappPriceCents)} per
          WhatsApp
          {low ? " · Low: top up soon" : ""}
        </p>
      </Card>
      {canSendNotices(actor.permissions) ? (
        <ButtonLink href="/dashboard/messages/new">Send a notice</ButtonLink>
      ) : null}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
        {links
          .filter((l) => l[3])
          .map(([href, title, hint]) => (
            <li key={href}>
              <Link
                href={href}
                className="flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
              >
                <span className="font-semibold text-ink">{title}</span>
                <span className="text-sm text-ink/60">{hint}</span>
              </Link>
            </li>
          ))}
      </ul>
      {notices.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-section font-bold">Recent notices</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/dashboard/messages/log?campaign=${n.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4"
                >
                  <span className="min-w-0 truncate text-ink">{n.title}</span>
                  <span className="shrink-0 text-sm text-ink/60" data-testid="read-count">
                    Read by {reads.get(n.id) ?? 0} of {n.recipients}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink/60">
            “Read” counts parents who opened the notice in the parent portal.
          </p>
        </section>
      ) : null}
    </div>
  );
}
