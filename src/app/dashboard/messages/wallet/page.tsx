import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { walletOverview } from "@/lib/messaging/wallet";
import { formatPhone } from "@/lib/phone";
import { nairobi } from "../../fees/shared";
import { retryTopupAction, thresholdAction, topupAction } from "../actions";
import { MessagesShell, loadMessagesActor } from "../shared";

export const metadata: Metadata = { title: "Messaging wallet · Kiota" };

export default function WalletPage() {
  return (
    <MessagesShell title="Messaging wallet">
      <Suspense fallback={<Loading />}>
        <Wallet />
      </Suspense>
    </MessagesShell>
  );
}

const TOPUP_STATUS: Record<string, string> = {
  stk_requested: "Waiting for the PIN",
  pending_verification: "Checking with Safaricom",
  verification_failed: "Not confirmed yet",
  posting: "Adding",
  completed: "Added",
  failed: "Not paid",
};

const METHOD: Record<string, string> = {
  mpesa: "M-Pesa",
  manual: "Bank transfer",
  starter: "Starter credit",
};

const monthName = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

async function Wallet() {
  const { ctx, actor } = await loadMessagesActor();
  const w = await walletOverview(deps, actor);
  const canTopUp = actor.permissions.has("wallet.topup");
  const low = w.balanceCents < w.lowBalanceThresholdCents;
  return (
    <div className="flex flex-col gap-5">
      <Card className={low ? "border-status-due/50 bg-status-due/5" : ""}>
        <p className="text-sm text-ink/70">Balance</p>
        <p
          className={`font-heading text-3xl font-bold ${w.balanceCents < 0 ? "text-status-overdue" : "text-teal"}`}
          data-testid="wallet-balance"
        >
          {kes(w.balanceCents)}
        </p>
        <p className="text-sm text-ink/60">
          {kes(w.prices.smsUnitPriceCents)} per SMS (160 characters) ·{" "}
          {kes(w.prices.whatsappPriceCents)} per WhatsApp message
        </p>
        <p className="text-sm text-ink/60">
          Sender name: {w.senderId ?? "KIOTA"}
          {w.senderIdPending ? ` (${w.senderIdPending} waiting for approval)` : ""}
        </p>
        {w.balanceCents <= 0 ? (
          <p className="mt-2 text-sm font-semibold text-status-overdue">
            The wallet is empty: only emergency messages and leave-out alerts go out (up to{" "}
            {kes(w.overdraftLimitCents)} below zero).
          </p>
        ) : null}
      </Card>

      {canTopUp ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold">Top up by M-Pesa</h2>
          {w.mpesaTopups ? (
            <ActionForm
              action={topupAction}
              submitLabel="Send M-Pesa prompt"
              pendingLabel="Sending…"
            >
              <Field
                label="Amount (KES)"
                name="amount"
                inputMode="numeric"
                required
                placeholder="1000"
              />
              <Field
                label="M-Pesa phone number"
                name="phone"
                inputMode="tel"
                required
                defaultValue={formatPhone(ctx.user.phone)}
                hint="A prompt appears on this phone. Pays Arend Studio, not the school fees Paybill."
              />
            </ActionForm>
          ) : (
            <Notice>
              M-Pesa top-ups are not switched on yet. Arend Studio can add credit after a bank
              transfer.
            </Notice>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Top-ups</h2>
        {w.topups.length === 0 ? (
          <p className="text-sm text-ink/60">No top-ups yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {w.topups.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-3"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">
                    {kes(t.amountCents)} · {METHOD[t.method] ?? t.method}
                  </span>
                  <span
                    className={`text-sm font-semibold ${t.status === "completed" ? "text-status-paid" : t.status === "failed" ? "text-status-overdue" : "text-status-due"}`}
                  >
                    {TOPUP_STATUS[t.status] ?? t.status}
                  </span>
                </div>
                <span className="text-sm text-ink/60">
                  {nairobi(t.createdAt)}
                  {t.transId ? ` · ${t.transId}` : ""}
                  {t.reference ? ` · ${t.reference}` : ""}
                </span>
                {t.statusDetail ? (
                  <span className="text-sm text-ink/60">{t.statusDetail}</span>
                ) : null}
                {canTopUp &&
                ["verification_failed", "stk_requested", "pending_verification"].includes(
                  t.status,
                ) ? (
                  <ActionForm
                    action={retryTopupAction}
                    submitLabel="Check again with Safaricom"
                    variant="secondary"
                  >
                    <input type="hidden" name="topupId" value={t.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Usage per month</h2>
        {w.months.length === 0 ? (
          <p className="text-sm text-ink/60">Nothing sent yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="py-1 font-semibold">Month</th>
                <th className="py-1 text-right font-semibold">Messages</th>
                <th className="py-1 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {w.months.map((m) => (
                <tr key={m.month} className="border-t border-ink/10">
                  <td className="py-2">{monthName(m.month)}</td>
                  <td className="py-2 text-right">{m.messages}</td>
                  <td className="py-2 text-right font-semibold">{kes(m.spentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-sm text-ink/60">
          Automatic messages this month (payment confirmations): {w.automaticThisMonth.messages},{" "}
          {kes(w.automaticThisMonth.spentCents)}.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Cost per send</h2>
        {w.campaigns.length === 0 ? (
          <p className="text-sm text-ink/60">No notices or reminders sent yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {w.campaigns.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/messages/log?campaign=${c.id}`}
                  className="flex justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-3 hover:border-teal/40"
                >
                  <span className="flex flex-col">
                    <span className="font-semibold">{c.title}</span>
                    <span className="text-sm text-ink/60">
                      {c.kind === "notice" ? "Notice" : "Fee reminders"} · {nairobi(c.createdAt)} ·{" "}
                      {c.recipients} parent{c.recipients === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="font-heading font-bold text-ink">{kes(c.spentCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canTopUp ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold">Low-balance alert</h2>
          <ActionForm action={thresholdAction} submitLabel="Save alert" variant="secondary">
            <Field
              label="Tell me when the balance drops below (KES)"
              name="threshold"
              inputMode="decimal"
              defaultValue={String(w.lowBalanceThresholdCents / 100)}
              hint="The Director and Bursar get an SMS and a note in Kiota, once until the next top-up."
            />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
