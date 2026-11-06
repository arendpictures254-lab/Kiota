import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink, Card, Loading } from "@/components/ui";
import { receiptNo } from "@/lib/fees/allocation";
import { money } from "@/lib/i18n";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { paymentStatus } from "@/lib/portal/service";
import { ParentShell } from "../../../parent-shell";
import { KeepChecking } from "./keep-checking";

export const metadata: Metadata = { title: "Payment · Kiota" };

/** Gives up waiting after this long (the receipt still appears under Fees if it comes later). */
const TIMEOUT_SECONDS = 120;

export default function PaymentStatusPage({
  params,
  searchParams,
}: PageProps<"/parent/[linkId]/pay/[transactionId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Status params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Status({ params, searchParams }: PageProps<"/parent/[linkId]/pay/[transactionId]">) {
  const { linkId, transactionId } = await params;
  const waited = Number((await searchParams).waited ?? 0) || 0;
  const { user, children, child, isStaff, t } = await requireChild(linkId);
  const status = await paymentStatus(portalDeps, user.id, transactionId);
  const timedOut =
    (status.state === "waiting" || status.state === "checking") && waited >= TIMEOUT_SECONDS;

  return (
    <ParentShell width="form" t={t} kids={children} current={linkId} isStaff={isStaff}>
      <Card className="flex flex-col gap-3">
        {status.state === "done" ? (
          <div role="status" className="flex flex-col gap-3">
            <h1 className="font-heading text-title font-bold text-status-paid">{t("pay.done")}</h1>
            <p className="text-ink/80">
              {money(status.amountCents)} · {child.firstName} {child.lastName}
            </p>
            <ButtonLink href={`/r/${status.shareToken}`}>
              {t("pay.openReceipt", { number: receiptNo(status.receiptNumber) })}
            </ButtonLink>
          </div>
        ) : status.state === "failed" ? (
          <div role="alert" className="flex flex-col gap-3">
            <h1 className="font-heading text-title font-bold text-status-overdue">
              {t("pay.failed")}
            </h1>
            {status.detail ? <p className="text-ink/80">{status.detail}</p> : null}
            <ButtonLink href={`/parent/${linkId}/pay`}>{t("pay.tryAgain")}</ButtonLink>
          </div>
        ) : timedOut || status.state === "unknown" ? (
          <div className="flex flex-col gap-3">
            <h1 className="font-heading text-title font-bold text-ink">{t("pay.timeout")}</h1>
            <p className="text-ink/80">{t("pay.timeoutHint")}</p>
            <ButtonLink href={`/parent/${linkId}/pay`}>{t("pay.tryAgain")}</ButtonLink>
          </div>
        ) : (
          <div role="status" className="flex flex-col gap-2">
            <h1 className="font-heading text-title font-bold text-ink">{t("pay.waiting")}</h1>
            <p className="text-ink/80">
              {status.state === "checking" ? t("pay.checking") : t("pay.waitingHint")}
            </p>
            <KeepChecking waited={waited} />
          </div>
        )}
      </Card>
      <ButtonLink href={`/parent/${linkId}/fees`} variant="secondary">
        {t("pay.backToFees")}
      </ButtonLink>
    </ParentShell>
  );
}
