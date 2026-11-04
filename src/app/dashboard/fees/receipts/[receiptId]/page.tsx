import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CopyButton, PrintButton } from "@/components/print-button";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { Card, Loading, Notice, TextArea } from "@/components/ui";
import { deps } from "@/lib/actions";
import { receiptNo } from "@/lib/fees/allocation";
import { getReceiptView, schoolCrest } from "@/lib/fees/receipts";
import { APP_URL } from "@/lib/hosts";
import { reversePaymentAction } from "../../actions";
import { FeesShell, loadFeesActor, nairobi } from "../../shared";

export const metadata: Metadata = { title: "Receipt · Kiota" };

type Props = PageProps<"/dashboard/fees/receipts/[receiptId]">;

export default function ReceiptPage({ params, searchParams }: Props) {
  return (
    <FeesShell back={{ href: "/dashboard/fees/payments", label: "Payments" }}>
      <Suspense fallback={<Loading />}>
        <Receipt params={params} searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Receipt({ params, searchParams }: Props) {
  const { receiptId } = await params;
  const sp = await searchParams;
  const { actor } = await loadFeesActor("fees.view", "fees.collect");
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) notFound();
  const r = await getReceiptView(deps, actor, receiptId);
  if (!r) notFound();
  const layout = sp.layout === "a4" ? "a4" : "thermal";
  const crest = await schoolCrest(r.school.logoKey, r.school.id);
  const crestDataUrl = crest
    ? `data:${crest.contentType};base64,${crest.bytes.toString("base64")}`
    : null;
  const share = `${APP_URL}/r/${r.shareToken}`;

  return (
    <div className="flex flex-col gap-4">
      {sp.new && !r.reversal ? (
        <Notice tone="success">Payment saved. Receipt No. {receiptNo(r.number)} issued.</Notice>
      ) : null}
      {r.reversal ? (
        <Notice tone="error">
          Reversed{r.reversal.by ? ` by ${r.reversal.by}` : ""} on {nairobi(r.reversal.at)}. The
          Director was notified. Reason: {r.reversal.reason}
        </Notice>
      ) : null}
      <div className="flex gap-2 print:hidden" role="group" aria-label="Receipt layout">
        {(["thermal", "a4"] as const).map((l) => (
          <Link
            key={l}
            href={`?layout=${l}`}
            aria-current={layout === l ? "page" : undefined}
            className={`flex-1 rounded-xl border px-3 py-2 text-center text-sm font-semibold ${layout === l ? "border-teal bg-teal text-white" : "border-ink/15 bg-white text-teal"}`}
          >
            {l === "thermal" ? "Thermal (80 mm)" : "A4"}
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white print:border-0">
        <ReceiptSheet
          r={r}
          layout={layout}
          crestDataUrl={crestDataUrl}
          shareUrl={share.replace(/^https?:\/\//, "")}
        />
      </div>
      <div className="flex flex-col gap-2 print:hidden">
        <PrintButton label={layout === "thermal" ? "Print thermal receipt" : "Print A4 receipt"} />
        <a
          href={`/files/receipts/${receiptId}?layout=${layout}`}
          className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white font-semibold text-teal hover:bg-egg-blue/30"
        >
          Download PDF
        </a>
        <CopyButton text={share} label="Copy share link" />
      </div>
      {actor.permissions.has("fees.reverse") && !r.reversal ? (
        <Card className="print:hidden">
          <ActionForm
            action={reversePaymentAction}
            submitLabel="Reverse this payment"
            variant="danger"
            pendingLabel="Reversing…"
          >
            <h2 className="font-heading text-lg font-bold">Reverse this payment</h2>
            <p className="text-sm text-ink/70">
              The receipt stays on record, marked reversed. The balance goes back up and the
              Director is told.
            </p>
            <input type="hidden" name="paymentId" value={r.paymentId ?? ""} />
            <TextArea label="Reason" name="reason" required minLength={5} />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
