import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { receiptNo } from "@/lib/fees/allocation";
import { day, type MessageKey, money } from "@/lib/i18n";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { childFees } from "@/lib/portal/service";
import { FeeSummary } from "../../fee-summary";
import { ParentShell } from "../../parent-shell";

export const metadata: Metadata = { title: "Fees · Kiota" };

export default function FeesPage({ params }: PageProps<"/parent/[linkId]/fees">) {
  return (
    <Suspense fallback={<Loading />}>
      <Fees params={params} />
    </Suspense>
  );
}

async function Fees({ params }: Pick<PageProps<"/parent/[linkId]/fees">, "params">) {
  const { linkId } = await params;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  if (!child.receivesFees) notFound();
  const fees = await childFees(portalDeps, user.id, linkId);
  if (!fees) notFound();
  const method = (m: string) => t(`fees.method.${m}` as MessageKey);

  return (
    <ParentShell
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={`${t("fees.title")}: ${child.firstName}`}
      back={{ href: `/parent/${linkId}`, label: child.firstName }}
    >
      <FeeSummary fees={fees} linkId={linkId} t={t} locale={locale} />

      {fees.voteHeads.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-lg font-bold">{t("fees.byVoteHead")}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-2xl border border-ink/10 bg-white p-4 text-sm">
            {fees.voteHeads.map((v) => (
              <div key={v.name ?? "credit"} className="contents">
                <dt className="text-ink/80">{v.name ?? t("fees.credit")}</dt>
                <dd className="text-right font-semibold">{money(v.balanceCents)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">{t("fees.invoices")}</h2>
        {fees.invoices.length === 0 ? <p className="text-ink/60">{t("fees.noInvoices")}</p> : null}
        {fees.invoices.map((i) => (
          <div
            key={i.id}
            className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold">
                {t("fees.invoice", { term: i.term, year: i.year })}
              </span>
              <span className="font-semibold">{money(i.totalCents)}</span>
            </div>
            {i.installments.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {i.installments.map((p) => (
                  <li
                    key={p.dueDate.toISOString()}
                    className={p.overdue ? "font-semibold text-status-overdue" : "text-ink/70"}
                  >
                    {t("fees.dueBy", { percent: p.percentBp / 100, date: day(p.dueDate, locale) })}
                    {p.overdue ? ` · ${t("fees.overdue")}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">{t("fees.payments")}</h2>
        {fees.payments.length === 0 ? <p className="text-ink/60">{t("fees.noPayments")}</p> : null}
        <ul className="flex flex-col gap-2">
          {fees.payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4"
            >
              <div className="flex justify-between gap-2">
                <span className={`font-semibold ${p.reversed ? "text-ink/50 line-through" : ""}`}>
                  {money(p.amountCents)}
                </span>
                <span className="text-sm text-ink/60">{day(p.paidAt, locale)}</span>
              </div>
              <span className="text-sm text-ink/70">
                {method(p.method)}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.reversed ? ` · ${t("fees.reversed")}` : ""}
              </span>
              {p.shareToken && p.receiptNumber !== null ? (
                <div className="flex items-center gap-4 text-sm font-semibold text-teal">
                  <span className="text-ink/70">
                    {t("fees.receipt", { number: receiptNo(p.receiptNumber) })}
                  </span>
                  <a href={`/r/${p.shareToken}`} className="flex h-11 items-center">
                    {t("fees.view")}
                  </a>
                  <a href={`/r/${p.shareToken}/pdf`} className="flex h-11 items-center">
                    {t("fees.download")}
                  </a>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </ParentShell>
  );
}
