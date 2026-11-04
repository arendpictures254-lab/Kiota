import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { listMpesaTransactions } from "@/lib/mpesa/service";
import { formatPhone } from "@/lib/phone";
import { assignSuspenseAction, retryVerificationAction, sendStkAction } from "../actions";
import { FeesShell, loadFeesActor, nairobi } from "../shared";

export const metadata: Metadata = { title: "M-Pesa · Kiota" };

const STATUS: Record<string, string> = {
  posted: "Posted",
  assigned: "Assigned",
  suspense: "In suspense",
  pending_verification: "Checking with Safaricom",
  verification_failed: "Could not confirm",
  rejected: "Rejected (not confirmed)",
  stk_requested: "Prompt sent",
  failed: "Not paid",
  merged: "Duplicate of Paybill payment",
  posting: "Posting",
};

export default function MpesaPage({ searchParams }: PageProps<"/dashboard/fees/mpesa">) {
  return (
    <FeesShell title="M-Pesa">
      <Suspense fallback={<Loading />}>
        <Mpesa searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Mpesa({ searchParams }: Pick<PageProps<"/dashboard/fees/mpesa">, "searchParams">) {
  const { actor } = await loadFeesActor("fees.collect");
  const sp = await searchParams;
  const all = await listMpesaTransactions(deps, actor);
  const attention = all.filter(
    (t) => t.status === "suspense" || t.status === "verification_failed",
  );
  const recent = all.filter((t) => !attention.includes(t)).slice(0, 30);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Needs attention</h2>
        {attention.length === 0 ? <Notice tone="success">Nothing in suspense.</Notice> : null}
        {attention.map((t) => (
          <Card key={t.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {t.amountCents ? kes(t.amountCents) : "—"} · {t.transId}
                </p>
                <p className="text-sm text-ink/70">
                  {t.payerName ?? "Unknown payer"}
                  {t.msisdn
                    ? ` · ${formatPhone(t.msisdn.startsWith("+") ? t.msisdn : `+${t.msisdn}`)}`
                    : ""}{" "}
                  · {nairobi(t.createdAt)}
                </p>
                <p className="text-sm text-status-due">{t.statusDetail}</p>
              </div>
              <span className="shrink-0 rounded-full bg-status-due/10 px-3 py-1 text-xs font-semibold text-status-due">
                {STATUS[t.status] ?? t.status}
              </span>
            </div>
            {t.status === "suspense" ? (
              <ActionForm
                action={assignSuspenseAction}
                submitLabel="Assign and issue receipt"
                variant="secondary"
              >
                <input type="hidden" name="txnId" value={t.id} />
                <Field
                  label="Student's admission number"
                  name="admissionNumber"
                  id={`adm-${t.id}`}
                  defaultValue={t.billRef ?? ""}
                  required
                />
              </ActionForm>
            ) : (
              <ActionForm
                action={retryVerificationAction}
                submitLabel="Check with Safaricom again"
                variant="secondary"
              >
                <input type="hidden" name="txnId" value={t.id} />
              </ActionForm>
            )}
          </Card>
        ))}
      </section>

      <Card>
        <ActionForm
          action={sendStkAction}
          submitLabel="Send payment prompt"
          pendingLabel="Sending…"
        >
          <h2 className="font-heading text-lg font-bold">Send an M-Pesa prompt</h2>
          <p className="text-sm text-ink/70">
            The parent gets a pop-up on their phone and enters their M-Pesa PIN. The receipt is
            issued automatically when Safaricom confirms.
          </p>
          <Field
            label="Admission number"
            name="admissionNumber"
            defaultValue={typeof sp.adm === "string" ? sp.adm : ""}
            required
          />
          <Field
            label="Parent's M-Pesa number"
            name="phone"
            type="tel"
            placeholder="0712 345 678"
            defaultValue={typeof sp.phone === "string" ? sp.phone : ""}
            required
          />
          <Field label="Amount (whole shillings)" name="amount" inputMode="numeric" required />
        </ActionForm>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Recent M-Pesa activity</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink/60">No M-Pesa payments yet.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {recent.map((t) => (
            <li
              key={t.id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-3 text-sm"
            >
              <span>
                <span className="font-semibold">{t.amountCents ? kes(t.amountCents) : "—"}</span> ·{" "}
                {t.transId ?? (t.kind === "stk" ? "Prompt" : "")}
                <span className="block text-ink/60">
                  {t.billRef ? `Account ${t.billRef} · ` : ""}
                  {nairobi(t.createdAt)}
                </span>
                {t.statusDetail ? (
                  <span className="block text-ink/60">{t.statusDetail}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs font-semibold text-teal">
                {t.paymentId ? (
                  <Link href={`/dashboard/fees/payments?q=${t.transId}`}>{STATUS[t.status]}</Link>
                ) : (
                  (STATUS[t.status] ?? t.status)
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
