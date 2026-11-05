import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { canSendNotices } from "@/lib/messaging/service";
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
  const links: [string, string, string, boolean][] = [
    [
      "/dashboard/messages/log",
      "Message history",
      "Every SMS and WhatsApp, with its status and cost",
      true,
    ],
    ["/dashboard/messages/wallet", "Wallet", "Top up, usage per month, cost per message", true],
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
          className={`font-heading text-3xl font-bold ${w.balanceCents < 0 ? "text-status-overdue" : "text-teal"}`}
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
      <ul className="flex flex-col gap-2">
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
    </div>
  );
}
