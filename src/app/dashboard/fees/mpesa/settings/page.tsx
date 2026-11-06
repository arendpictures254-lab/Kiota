import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { getMpesaSettings } from "@/lib/mpesa/service";
import { registerUrlsAction, saveMpesaSettingsAction } from "../../actions";
import { FeesShell, loadFeesActor } from "../../shared";

export const metadata: Metadata = { title: "M-Pesa settings · Kiota" };

export default function MpesaSettingsPage() {
  return (
    <FeesShell width="form" title="M-Pesa settings">
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </FeesShell>
  );
}

async function Settings() {
  const { actor } = await loadFeesActor("fees.setup");
  const s = await getMpesaSettings(deps, actor);
  const saved = (has: boolean | undefined) => (has ? "Saved. Leave blank to keep it." : undefined);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink/70">
        Your school&apos;s own Paybill and Daraja credentials. Secrets are encrypted and never shown
        again after saving.
      </p>
      <Card>
        <ActionForm action={saveMpesaSettingsAction} submitLabel="Save M-Pesa settings">
          <Select
            label="Environment"
            name="environment"
            defaultValue={s?.environment ?? "simulator"}
            options={[
              { value: "simulator", label: "Simulator (this computer, no real money)" },
              { value: "sandbox", label: "Daraja sandbox (Safaricom test system)" },
              { value: "production", label: "Live (real money)" },
            ]}
          />
          <Field
            label="Paybill or Till number"
            name="shortcode"
            defaultValue={s?.shortcode ?? "174379"}
            inputMode="numeric"
            required
          />
          <Select
            label="Type"
            name="shortcodeType"
            defaultValue={s?.shortcodeType ?? "paybill"}
            options={[
              { value: "paybill", label: "Paybill (parents type the admission number as account)" },
              { value: "till", label: "Till (Buy Goods)" },
            ]}
          />
          <Field
            label="Consumer key"
            name="consumerKey"
            autoComplete="off"
            hint={saved(s?.hasConsumerKey)}
          />
          <Field
            label="Consumer secret"
            name="consumerSecret"
            type="password"
            autoComplete="off"
            hint={saved(s?.hasConsumerSecret)}
          />
          <Field
            label="Lipa na M-Pesa passkey"
            name="passkey"
            type="password"
            autoComplete="off"
            hint={saved(s?.hasPasskey)}
          />
          <Field
            label="Initiator name"
            name="initiatorName"
            defaultValue={s?.initiatorName ?? ""}
            autoComplete="off"
          />
          <Field
            label="Security credential"
            name="securityCredential"
            type="password"
            autoComplete="off"
            hint={
              saved(s?.hasSecurityCredential) ??
              "The encrypted initiator password from the Daraja portal."
            }
          />
        </ActionForm>
      </Card>

      {s ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-heading text-section font-bold">Callback addresses</h2>
          <p className="text-sm text-ink/70">
            Safaricom sends payments here. They contain a secret: do not share them.
          </p>
          <dl className="flex flex-col gap-2 text-xs break-all">
            {Object.entries(s.urls).map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold text-ink">{k}</dt>
                <dd className="font-mono text-ink/70">{v}</dd>
              </div>
            ))}
          </dl>
          {s.environment === "simulator" ? (
            <Notice>
              Simulator: use `npm run mpesa:simulate` on this computer to send test payments.
            </Notice>
          ) : (
            <ActionForm
              action={registerUrlsAction}
              submitLabel="Register with Safaricom"
              variant="secondary"
            />
          )}
        </Card>
      ) : null}
    </div>
  );
}
