import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Card, Loading, Notice } from "@/components/ui";
import { day, money } from "@/lib/i18n";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { childFees, childLabel, childNotices, sections } from "@/lib/portal/service";
import { Avatar, ParentShell } from "../parent-shell";

export const metadata: Metadata = { title: "Kiota" };

export default function ChildPage({ params, searchParams }: PageProps<"/parent/[linkId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Child params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Child({ params, searchParams }: PageProps<"/parent/[linkId]">) {
  const { linkId } = await params;
  const added = (await searchParams).added;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  const s = sections(child);
  const [fees, notices] = await Promise.all([
    s.fees ? childFees(portalDeps, user.id, linkId) : null,
    s.notices ? childNotices(portalDeps, user.id, linkId) : [],
  ]);
  const unread = notices.filter((n) => !n.readAt).length;
  const placeholders = [
    s.reportCards ? t("child.reportCards") : null,
    s.leaveOuts ? t("child.leaveOuts") : null,
    s.pocketMoney ? t("child.pocketMoney") : null,
  ].filter((x): x is string => !!x);

  return (
    <ParentShell t={t} kids={children} current={linkId} isStaff={isStaff}>
      {added ? (
        <Notice tone="success">{t("pending.confirmed", { child: String(added) })}</Notice>
      ) : null}
      <div className="flex items-center gap-3">
        <Avatar child={child} size={56} />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-ink">
            {child.firstName} {child.lastName}
          </h1>
          <p className="text-sm text-ink/60">
            {[childLabel(child), child.admissionNumber, child.schoolName]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {fees ? (
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-ink/70">{t("fees.balance")}</p>
            <p
              className={`font-heading text-3xl font-bold ${
                fees.balanceCents > 0
                  ? fees.overdueCents > 0
                    ? "text-status-overdue"
                    : "text-ink"
                  : "text-status-paid"
              }`}
              data-testid="child-balance"
            >
              {fees.balanceCents > 0
                ? money(fees.balanceCents)
                : fees.balanceCents < 0
                  ? t("child.inCredit", { amount: money(-fees.balanceCents) })
                  : t("child.paidUp")}
            </p>
            {fees.overdueCents > 0 ? (
              <p className="text-sm font-semibold text-status-overdue">
                {t("fees.overdueAmount", { amount: money(fees.overdueCents) })}
                {fees.overdueSince ? ` · ${day(fees.overdueSince, locale)}` : ""}
              </p>
            ) : null}
          </div>
          {fees.balanceCents > 0 && fees.mpesa ? (
            <ButtonLink href={`/parent/${linkId}/pay`}>{t("fees.pay")}</ButtonLink>
          ) : null}
        </Card>
      ) : null}

      <nav className="flex flex-col gap-2">
        {s.fees ? <Row href={`/parent/${linkId}/fees`} label={t("child.fees")} /> : null}
        {s.notices ? (
          <Row
            href={`/parent/${linkId}/notices`}
            label={t("child.notices")}
            badge={unread ? t("child.newNotices", { n: unread }) : undefined}
          />
        ) : null}
        {placeholders.map((p) => (
          <div
            key={p}
            className="flex min-h-14 items-center justify-between rounded-2xl border border-dashed border-ink/20 px-4 text-ink/50"
          >
            <span className="font-semibold">{p}</span>
            <span className="text-sm">{t("child.comingSoon")}</span>
          </div>
        ))}
      </nav>
    </ParentShell>
  );
}

function Row({ href, label, badge }: { href: string; label: string; badge?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-between rounded-2xl border border-ink/10 bg-white px-4"
    >
      <span className="font-semibold text-ink">{label}</span>
      <span className="flex items-center gap-2 text-sm text-teal">
        {badge ? (
          <span className="rounded-full bg-teal px-2 py-0.5 text-xs font-bold text-white">
            {badge}
          </span>
        ) : null}
        →
      </span>
    </Link>
  );
}
