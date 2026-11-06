import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { money, pick } from "@/lib/i18n";
import { formatPhone } from "@/lib/phone";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { childFees } from "@/lib/portal/service";
import { ParentShell } from "../../parent-shell";
import { PayForm } from "./pay-form";

export const metadata: Metadata = { title: "Pay fees · Kiota" };

export default function PayPage({ params }: PageProps<"/parent/[linkId]/pay">) {
  return (
    <Suspense fallback={<Loading />}>
      <Pay params={params} />
    </Suspense>
  );
}

async function Pay({ params }: Pick<PageProps<"/parent/[linkId]/pay">, "params">) {
  const { linkId } = await params;
  const { user, children, child, isStaff, t } = await requireChild(linkId);
  const fees = child.receivesFees ? await childFees(portalDeps, user.id, linkId) : null;
  if (!fees) notFound();
  // Default: what is due now; when nothing is, the next instalment (or the balance).
  const suggestedCents =
    fees.dueNowCents > 0
      ? fees.dueNowCents
      : (fees.nextDue?.amountCents ?? Math.max(0, fees.balanceCents));
  const due = Math.ceil(suggestedCents / 100);

  return (
    <ParentShell
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={t("pay.title")}
      back={{ href: `/parent/${linkId}/fees`, label: t("child.fees") }}
    >
      <p className="-mt-3 text-ink/70">
        {t("pay.for", { child: `${child.firstName} ${child.lastName}`, school: child.schoolName })}
      </p>
      {fees.mpesa ? (
        <PayForm
          linkId={linkId}
          defaultAmount={due ? String(due) : ""}
          defaultPhone={formatPhone(user.phone)}
          text={{
            ...pick(t, ["pay.amount", "pay.phone", "pay.phoneHint", "pay.send", "pay.sending"]),
            amountHint: due ? t("pay.amountHint", { amount: money(suggestedCents) }) : "",
            paysTo: t("pay.paysTo", {
              school: child.schoolName,
              admission: child.admissionNumber ?? "",
            }),
          }}
        />
      ) : (
        <Notice>{t("fees.noMpesa")}</Notice>
      )}
    </ParentShell>
  );
}
