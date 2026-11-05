import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Loading, Notice } from "@/components/ui";
import { day, money } from "@/lib/i18n";
import { portalDeps, requireParent } from "@/lib/portal/context";
import { type Attention, childLabel, familyOverview } from "@/lib/portal/service";
import { Avatar, ParentShell } from "./parent-shell";

export const metadata: Metadata = { title: "Kiota" };

export default function ParentHomePage({ searchParams }: PageProps<"/parent">) {
  return (
    <Suspense fallback={<Loading />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: Pick<PageProps<"/parent">, "searchParams">) {
  const declined = (await searchParams).declined;
  const { user, children, isStaff, t, locale } = await requireParent();
  const o = await familyOverview(portalDeps, user.id);
  const live = o.perChild;

  const line = (a: Attention) => {
    switch (a.kind) {
      case "pending":
        return {
          href: `/parent/confirm/${a.linkId}`,
          text: t("pending.card", { school: a.school, child: a.child }),
          action: t("pending.review"),
          tone: "border-teal/40 bg-egg-blue/20",
        };
      case "overdue":
        return {
          href: `/parent/${a.linkId}/fees`,
          text: a.since
            ? t("home.overdue", {
                child: a.child,
                amount: money(a.amountCents),
                date: day(a.since, locale),
              })
            : t("home.overdueOld", { child: a.child, amount: money(a.amountCents) }),
          action: t("fees.pay"),
          tone: "border-status-overdue/30 bg-status-overdue/5",
        };
      case "unread":
        return {
          href: `/parent/${a.linkId}/notices`,
          text:
            a.count === 1
              ? t("home.unreadOne", { child: a.child })
              : t("home.unreadMany", { child: a.child, n: a.count }),
          action: t("notices.title"),
          tone: "border-ink/10 bg-white",
        };
    }
  };

  return (
    <ParentShell t={t} kids={children} current={null} isStaff={isStaff} title={t("home.title")}>
      {declined ? (
        <Notice tone="success">{t("pending.declined", { school: String(declined) })}</Notice>
      ) : null}
      {o.showsFees ? (
        <Card>
          <p className="text-sm text-ink/70">{t("home.totalBalance")}</p>
          <p
            className={`font-heading text-3xl font-bold ${o.totalBalanceCents > 0 ? "text-ink" : "text-status-paid"}`}
            data-testid="family-balance"
          >
            {o.totalBalanceCents > 0
              ? money(o.totalBalanceCents)
              : o.totalBalanceCents < 0
                ? t("home.inCredit", { amount: money(-o.totalBalanceCents) })
                : t("home.allPaid")}
          </p>
          <p className="text-sm text-ink/60">{t("home.acrossSchools")}</p>
        </Card>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="attention">
        <h2 id="attention" className="font-heading text-lg font-bold">
          {t("home.attention")}
        </h2>
        {o.attention.length === 0 ? (
          <p className="text-ink/60">{t("home.nothing")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {o.attention.map((a) => {
              const l = line(a);
              return (
                <li key={`${a.kind}-${a.linkId}`}>
                  <Link
                    href={l.href}
                    className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl border p-4 ${l.tone}`}
                  >
                    <span className="text-ink">{l.text}</span>
                    <span className="shrink-0 font-semibold text-teal">{l.action} →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {live.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="kids">
          <h2 id="kids" className="font-heading text-lg font-bold">
            {t("nav.children")}
          </h2>
          <ul className="flex flex-col gap-2">
            {live.map(({ child, fees, unread }) => (
              <li key={child.linkId}>
                <Link
                  href={`/parent/${child.linkId}`}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-ink/10 bg-white p-3"
                >
                  <Avatar child={child} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold text-ink">
                      {child.firstName} {child.lastName}
                    </span>
                    <span className="truncate text-sm text-ink/60">
                      {[childLabel(child), child.schoolName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-sm">
                    {fees ? (
                      <span
                        className={
                          fees.balanceCents > 0
                            ? fees.overdueCents > 0
                              ? "font-semibold text-status-overdue"
                              : "font-semibold text-status-due"
                            : "font-semibold text-status-paid"
                        }
                      >
                        {fees.balanceCents > 0 ? money(fees.balanceCents) : t("child.paidUp")}
                      </span>
                    ) : null}
                    {unread ? (
                      <span className="text-teal">{t("child.newNotices", { n: unread })}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-ink/70">{t("home.noChildren")}</p>
      )}
    </ParentShell>
  );
}
