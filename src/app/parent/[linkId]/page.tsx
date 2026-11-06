import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Loading, Notice } from "@/components/ui";
import { receiptNo } from "@/lib/fees/allocation";
import { day, money } from "@/lib/i18n";
import { portalDeps, requireChild } from "@/lib/portal/context";
import {
  childAttendance,
  childFees,
  childLabel,
  childNotices,
  sections,
} from "@/lib/portal/service";
import { FeeSummary } from "../fee-summary";
import { Avatar, ParentShell } from "../parent-shell";

export const metadata: Metadata = { title: "Kiota" };

export default function ChildPage({ params, searchParams }: PageProps<"/parent/[linkId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Child params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * A child's overview. Phone: what is due and the Pay button first, then Fees and Notices (all
 * above the fold on a 390x844 phone). From 1024 px: the child and what is due on the left; fees
 * by vote head, the latest notices and receipts on the right.
 */
async function Child({ params, searchParams }: PageProps<"/parent/[linkId]">) {
  const { linkId } = await params;
  const added = (await searchParams).added;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  const s = sections(child);
  const [fees, notices, attendance] = await Promise.all([
    s.fees ? childFees(portalDeps, user.id, linkId) : null,
    s.notices ? childNotices(portalDeps, user.id, linkId) : [],
    s.attendance ? childAttendance(portalDeps, user.id, linkId) : null,
  ]);
  const unread = notices.filter((n) => !n.readAt).length;
  const placeholders = [
    s.reportCards ? t("child.reportCards") : null,
    s.pocketMoney ? t("child.pocketMoney") : null,
  ].filter((x): x is string => !!x);
  const onlyChild = children.filter((k) => !k.pending).length === 1;
  const receipts = (fees?.payments ?? [])
    .filter((p) => p.shareToken && p.receiptNumber !== null)
    .slice(0, 3);

  return (
    <ParentShell t={t} kids={children} current={linkId} isStaff={isStaff}>
      {added ? (
        <Notice tone="success">{t("pending.confirmed", { child: String(added) })}</Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          {/* On a phone with one child, the slim header above already says who this is. */}
          <div className={`items-center gap-3 ${onlyChild ? "hidden lg:flex" : "flex"}`}>
            <Avatar child={child} size={56} />
            <div className="min-w-0">
              <h1 className="font-heading text-title font-bold text-ink">
                {child.firstName} {child.lastName}
              </h1>
              <p className="text-sm text-ink/60">
                {[childLabel(child), child.admissionNumber, child.schoolName]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          {onlyChild ? (
            <h1 className="sr-only">
              {child.firstName} {child.lastName}
            </h1>
          ) : null}

          {fees ? <FeeSummary fees={fees} linkId={linkId} t={t} locale={locale} /> : null}

          <nav className="flex flex-col gap-2">
            {s.fees ? <Row href={`/parent/${linkId}/fees`} label={t("child.fees")} /> : null}
            {s.notices ? (
              <Row
                href={`/parent/${linkId}/notices`}
                label={t("child.notices")}
                badge={unread ? t("child.newNotices", { n: unread }) : undefined}
              />
            ) : null}
            {s.leaveOuts ? (
              <Row href={`/parent/${linkId}/leaveouts`} label={t("child.leaveOuts")} />
            ) : null}
            {attendance ? (
              <Row
                href={`/parent/${linkId}/attendance`}
                label={t("child.attendance")}
                badge={attendance.percent === null ? undefined : `${attendance.percent}%`}
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
        </div>

        <div className="flex flex-col gap-4">
          {fees && fees.voteHeads.length ? (
            <Box
              title={t("fees.byVoteHead")}
              href={`/parent/${linkId}/fees`}
              more={t("child.seeAll")}
            >
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-sm">
                {fees.voteHeads.map((v) => (
                  <div key={v.name ?? "credit"} className="contents">
                    <dt className="text-ink/80">{v.name ?? t("fees.credit")}</dt>
                    <dd className="text-right font-semibold">{money(v.balanceCents)}</dd>
                  </div>
                ))}
              </dl>
            </Box>
          ) : null}
          {s.notices && notices.length ? (
            <Box
              title={t("child.latestNotices")}
              href={`/parent/${linkId}/notices`}
              more={t("child.seeAll")}
            >
              <ul className="divide-y divide-ink/5">
                {notices.slice(0, 3).map((n) => (
                  <li key={n.id} className="flex flex-col gap-1 px-4 py-3">
                    <span className="flex items-center gap-2 text-xs text-ink/60">
                      {day(n.sentAt, locale)}
                      {!n.readAt ? (
                        <span className="rounded-full bg-teal px-2 py-0.5 font-bold text-white">
                          {t("notices.new")}
                        </span>
                      ) : null}
                    </span>
                    <span className="line-clamp-3 text-sm text-ink">{n.body}</span>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
          {receipts.length ? (
            <Box
              title={t("child.latestReceipts")}
              href={`/parent/${linkId}/fees`}
              more={t("child.seeAll")}
            >
              <ul className="divide-y divide-ink/5">
                {receipts.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`/r/${p.shareToken}`}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-egg-blue/15"
                    >
                      <span className="flex flex-col">
                        <span className="font-semibold">
                          {t("fees.receipt", { number: receiptNo(p.receiptNumber!) })}
                        </span>
                        <span className="text-sm text-ink/60">{day(p.paidAt, locale)}</span>
                      </span>
                      <span
                        className={`font-semibold ${p.reversed ? "text-ink/40 line-through" : ""}`}
                      >
                        {money(p.amountCents)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Box>
          ) : null}
        </div>
      </div>
    </ParentShell>
  );
}

function Box({
  title,
  href,
  more,
  children,
}: {
  title: string;
  href: string;
  more: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-white" aria-label={title}>
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-2">
        <h2 className="font-heading text-section font-bold">{title}</h2>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-teal"
        >
          {more} →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Row({ href, label, badge }: { href: string; label: string; badge?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 hover:border-teal/40"
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
