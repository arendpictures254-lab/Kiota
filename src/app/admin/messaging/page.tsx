import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, Checkbox, Field, Loading, Select, Shell } from "@/components/ui";
import { requireUser } from "@/lib/auth/context";
import { platformDb } from "@/lib/db";
import { kes } from "@/lib/fees/allocation";
import { WHATSAPP_STATUSES, adminTemplates, adminWallets } from "@/lib/messaging/wallet";
import { creditWalletAction, templateStatusAction, walletSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Messaging · Arend Studio admin · Kiota" };

export default function AdminMessagingPage() {
  return (
    <Shell
      title="Messaging wallets"
      back={{ href: "/admin", label: "Schools" }}
      aside={<SignOutButton />}
    >
      <Suspense fallback={<Loading />}>
        <Wallets />
      </Suspense>
    </Shell>
  );
}

const shillings = (cents: number) => (cents / 100).toFixed(2);

const STATUS_LABEL: Record<string, string> = {
  not_submitted: "Not submitted",
  pending: "Waiting for Meta",
  approved: "Approved",
  rejected: "Rejected",
};

async function Wallets() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/dashboard");
  const admin = { userId: user.id, isPlatformAdmin: true };
  const [wallets, templates] = await Promise.all([
    adminWallets({ db: platformDb }, admin),
    adminTemplates({ db: platformDb }, admin),
  ]);
  const total = wallets.reduce((n, w) => n + w.usedThisMonthCents, 0);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink/70">
        Used this month across all schools: <strong>{kes(total)}</strong>. Balances are what each
        school has prepaid; Kiota never shows their messages here.
      </p>
      {wallets.map((w) => (
        <Card key={w.schoolId} className="flex flex-col gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold">{w.name}</h2>
            <p className="text-sm text-ink/70">
              Balance{" "}
              <strong
                className={
                  w.balanceCents < w.lowBalanceThresholdCents ? "text-status-overdue" : "text-teal"
                }
              >
                {kes(w.balanceCents)}
              </strong>{" "}
              · this month {kes(w.usedThisMonthCents)} on {w.messagesThisMonth} messages
            </p>
          </div>
          <details>
            <summary className="cursor-pointer font-semibold text-teal">
              Prices and sender ID
            </summary>
            <ActionForm
              action={walletSettingsAction}
              submitLabel="Save prices"
              variant="secondary"
              className="mt-3 flex flex-col gap-3"
            >
              <input type="hidden" name="schoolId" value={w.schoolId} />
              <Field
                label="Price per SMS unit (KES)"
                name="smsPrice"
                inputMode="decimal"
                defaultValue={shillings(w.smsUnitPriceCents)}
              />
              <Field
                label="Price per WhatsApp message (KES)"
                name="whatsappPrice"
                inputMode="decimal"
                defaultValue={shillings(w.whatsappPriceCents)}
              />
              <Field
                label="Overdraft for critical messages (KES)"
                name="overdraft"
                inputMode="decimal"
                defaultValue={shillings(w.overdraftLimitCents)}
                hint="How far below zero leave-out alerts and emergencies may go."
              />
              <Field
                label="Sender ID"
                name="senderId"
                maxLength={11}
                defaultValue={w.senderId ?? w.shortName}
              />
              <Checkbox
                name="senderIdApproved"
                label="Sender ID approved by the networks"
                description="Until then messages go out under KIOTA."
                defaultChecked={w.senderIdApproved}
              />
            </ActionForm>
          </details>
          <details>
            <summary className="cursor-pointer font-semibold text-teal">Add credit</summary>
            <ActionForm
              action={creditWalletAction}
              submitLabel="Add credit"
              variant="secondary"
              className="mt-3 flex flex-col gap-3"
            >
              <input type="hidden" name="schoolId" value={w.schoolId} />
              <Select
                label="Kind"
                name="kind"
                options={[
                  { value: "manual", label: "Bank transfer received" },
                  { value: "starter", label: "Free starter credit" },
                ]}
              />
              <Field label="Amount (KES)" name="amount" inputMode="decimal" required />
              <Field label="Bank reference" name="reference" hint="Required for bank transfers." />
              <Field label="Note" name="note" />
            </ActionForm>
          </details>
        </Card>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">WhatsApp templates</h2>
        <p className="text-sm text-ink/70">
          Mark a template approved only after Meta approves it in WhatsApp Manager. Until then
          parents get the SMS version.
        </p>
        {templates.map((t) => (
          <Card key={`${t.key}:${t.language}`} className="flex flex-col gap-2">
            <p className="font-semibold">
              {t.whatsappName ?? t.key} · {t.language === "sw" ? "Kiswahili" : "English"}
            </p>
            <p className="text-sm text-ink/70">{t.whatsappBody ?? t.smsBody}</p>
            <ActionForm action={templateStatusAction} submitLabel="Save status" variant="secondary">
              <input type="hidden" name="key" value={t.key} />
              <input type="hidden" name="language" value={t.language} />
              <Select
                label="Status"
                name="status"
                defaultValue={t.whatsappStatus}
                options={WHATSAPP_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </ActionForm>
          </Card>
        ))}
      </section>
    </div>
  );
}
