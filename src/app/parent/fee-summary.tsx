import { ButtonLink, Card, Notice } from "@/components/ui";
import { type Locale, type T, day, money } from "@/lib/i18n";
import type { ChildFees } from "@/lib/portal/service";

/**
 * What a parent needs to know about fees, in this order: what is due now (overdue plus anything
 * due today) with the Pay button, then the rest of the year with the next due date. "Arrears"
 * means only unpaid balances from previous terms.
 */
export function FeeSummary({
  fees,
  linkId,
  t,
  locale,
}: {
  fees: NonNullable<ChildFees>;
  linkId: string;
  t: T;
  locale: Locale;
}) {
  const late = fees.arrearsCents > 0 || !!fees.missedSince;
  return (
    <Card className="flex flex-col gap-4">
      {fees.balanceCents < 0 ? (
        <p className="font-heading text-2xl font-bold text-status-paid" data-testid="due-now">
          {t("child.inCredit", { amount: money(-fees.balanceCents) })}
        </p>
      ) : (
        <div>
          <p className="text-sm text-ink/70">{t("fees.dueNow")}</p>
          {fees.dueNowCents > 0 ? (
            <p
              className={`font-heading text-display font-bold ${late ? "text-status-overdue" : "text-ink"}`}
              data-testid="due-now"
            >
              {money(fees.dueNowCents)}
            </p>
          ) : (
            <p className="font-heading text-2xl font-bold text-status-paid" data-testid="due-now">
              {t("fees.nothingDueNow")}
            </p>
          )}
          {fees.arrearsCents > 0 ? (
            <p className="text-sm font-semibold text-status-overdue">
              {t("fees.includesArrears", { amount: money(fees.arrearsCents) })}
            </p>
          ) : null}
          {fees.missedSince ? (
            <p className="text-sm font-semibold text-status-overdue">
              {t("fees.missedDate", { date: day(fees.missedSince, locale) })}
            </p>
          ) : null}
        </div>
      )}

      {fees.balanceCents > 0 ? (
        fees.mpesa ? (
          <ButtonLink href={`/parent/${linkId}/pay`}>{t("fees.pay")}</ButtonLink>
        ) : (
          <Notice>{t("fees.noMpesa")}</Notice>
        )
      ) : null}

      {fees.restOfYearCents > 0 ? (
        <div className="border-t border-ink/10 pt-3" data-testid="rest-of-year">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-ink/70">{t("fees.restOfYear")}</span>
            <span className="font-semibold">{money(fees.restOfYearCents)}</span>
          </div>
          {fees.nextDue ? (
            <p className="text-sm text-ink/60">
              {t("fees.nextDue", {
                amount: money(fees.nextDue.amountCents),
                date: day(fees.nextDue.date, locale),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {fees.balanceCents > 0 ? (
        <p className="text-sm text-ink/60">
          {t("fees.total", { amount: money(fees.balanceCents) })}
        </p>
      ) : null}
    </Card>
  );
}
