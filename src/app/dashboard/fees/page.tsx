import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { kes } from "@/lib/fees/allocation";
import { ctxOf } from "@/lib/service-kit";
import { FeesShell, loadFeesActor, startOfTodayNairobi } from "./shared";

export const metadata: Metadata = { title: "Fees · Kiota" };

export default function FeesPage() {
  return (
    <FeesShell title="Fees" back={{ href: "/dashboard", label: "Dashboard" }}>
      <Suspense fallback={<Loading />}>
        <Hub />
      </Suspense>
    </FeesShell>
  );
}

async function Hub() {
  const { actor } = await loadFeesActor();
  const can = (p: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(p);
  const stats = await withContext(deps.db, ctxOf(actor), async (tx) => {
    const from = startOfTodayNairobi();
    const [today, suspense] = await Promise.all([
      tx.payment.aggregate({
        where: { schoolId: actor.schoolId, createdAt: { gte: from }, reversal: null },
        _sum: { amountCents: true },
        _count: true,
      }),
      can("fees.collect")
        ? tx.mpesaTransaction.count({
            where: {
              schoolId: actor.schoolId,
              status: { in: ["suspense", "verification_failed"] },
            },
          })
        : 0,
    ]);
    return { todayCents: today._sum.amountCents ?? 0, todayCount: today._count, suspense };
  });

  const links: [string, string, string, boolean][] = [
    [
      "/dashboard/fees/payments",
      "Payments and receipts",
      "Find, print or reverse a receipt",
      can("fees.view") || can("fees.collect"),
    ],
    [
      "/dashboard/fees/mpesa",
      "M-Pesa",
      stats.suspense
        ? `${stats.suspense} payment${stats.suspense === 1 ? "" : "s"} need attention`
        : "Suspense and payment prompts",
      can("fees.collect"),
    ],
    [
      "/dashboard/fees/reports",
      "Reports",
      "Collected vs expected, defaulters, daily collection, export",
      can("fees.reports"),
    ],
    [
      "/dashboard/fees/pledges",
      "Pledges",
      "Promises to pay by a date",
      can("fees.collect") || can("fees.reports"),
    ],
    [
      "/dashboard/fees/invoices",
      "Invoices and charges",
      "Term invoices, opening balances, one-off charges",
      can("fees.setup"),
    ],
    [
      "/dashboard/fees/setup",
      "Fee setup",
      "Vote heads, fee structures, discounts, bursaries",
      can("fees.setup"),
    ],
    [
      "/dashboard/fees/mpesa/settings",
      "M-Pesa settings",
      "Paybill and Daraja credentials",
      can("fees.setup"),
    ],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-white p-5">
        <p className="text-sm text-ink/60">Received today</p>
        <p className="font-heading text-3xl font-bold text-teal">{kes(stats.todayCents)}</p>
        <p className="text-sm text-ink/60">
          {stats.todayCount} payment{stats.todayCount === 1 ? "" : "s"}
        </p>
      </div>
      {can("fees.collect") ? (
        <ButtonLink href="/dashboard/fees/pay">Record a payment</ButtonLink>
      ) : null}
      <ul className="flex flex-col gap-2">
        {links
          .filter(([, , , show]) => show)
          .map(([href, title, text]) => (
            <li key={href}>
              <Link
                href={href}
                className="flex flex-col rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal"
              >
                <span className="font-semibold text-ink">{title}</span>
                <span
                  className={`text-sm ${title === "M-Pesa" && stats.suspense ? "font-semibold text-status-due" : "text-ink/60"}`}
                >
                  {text}
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
