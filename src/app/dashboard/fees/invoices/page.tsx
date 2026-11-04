import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { previewOpeningBalances, previewTermInvoices } from "@/lib/fees/invoicing";
import { getFeeSetup } from "@/lib/fees/setup";
import { ValidationError } from "@/lib/service-kit";
import { addChargeAction, generateInvoicesAction, postOpeningBalancesAction } from "../actions";
import { FeesShell, loadFeesActor } from "../shared";

export const metadata: Metadata = { title: "Invoices and charges · Kiota" };

type Props = PageProps<"/dashboard/fees/invoices">;

export default function InvoicesPage({ searchParams }: Props) {
  return (
    <FeesShell title="Invoices and charges">
      <Suspense fallback={<Loading />}>
        <Invoices searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Invoices({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadFeesActor("fees.setup");
  const sp = await searchParams;
  const setup = await getFeeSetup(deps, actor);
  const termId = typeof sp.termId === "string" ? sp.termId : "";
  let preview = null;
  let problem = null;
  if (termId) {
    try {
      preview = await previewTermInvoices(deps, actor, termId);
    } catch (err) {
      if (err instanceof ValidationError) problem = err.message;
      else throw err;
    }
  }
  const opening = await previewOpeningBalances(deps, actor);
  const terms = setup.terms.map((t) => ({
    value: t.id,
    label: `${t.name} ${t.academicYear.name}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Term invoices</h2>
        <p className="text-sm text-ink/70">
          Bills every active student for the term from the fee structures, with sibling discounts
          and bursaries. Students already invoiced are skipped, so it is safe to run again after
          admitting new students.
        </p>
        <form method="get" className="flex flex-col gap-3">
          <Select
            label="Term"
            name="termId"
            defaultValue={termId}
            placeholder="Choose a term"
            options={terms}
          />
          <Button type="submit" variant="secondary">
            Preview
          </Button>
        </form>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {preview ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>Invoices to create</dt>
              <dd className="text-right font-semibold">{preview.totals.invoices}</dd>
              <dt>Fees</dt>
              <dd className="text-right">{kes(preview.totals.grossCents)}</dd>
              <dt>Sibling discounts ({preview.totals.discountCount})</dt>
              <dd className="text-right">-{kes(preview.totals.discountCents)}</dd>
              <dt>Bursaries ({preview.totals.bursaryCount})</dt>
              <dd className="text-right">-{kes(preview.totals.bursaryCents)}</dd>
              <dt className="font-semibold">To collect</dt>
              <dd className="text-right font-heading font-bold text-teal">
                {kes(preview.totals.netCents)}
              </dd>
              <dt>Already invoiced</dt>
              <dd className="text-right">{preview.alreadyInvoiced}</dd>
            </dl>
            {preview.missing.length ? (
              <Notice tone="error">
                {preview.missing.length} student{preview.missing.length === 1 ? "" : "s"} will not
                be invoiced: {[...new Set(preview.missing.map((m) => m.reason))].join("; ")}. Add
                the fee structure first.
              </Notice>
            ) : null}
            {preview.totals.invoices > 0 ? (
              <ActionForm
                action={generateInvoicesAction}
                submitLabel={`Create ${preview.totals.invoices} invoices`}
                pendingLabel="Creating…"
              >
                <input type="hidden" name="termId" value={termId} />
              </ActionForm>
            ) : (
              <Notice tone="success">Every student is invoiced for this term.</Notice>
            )}
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Opening balances</h2>
        <p className="text-sm text-ink/70">
          From the Excel import. Posting puts each one on the student&apos;s ledger as its first
          entry (debts to Arrears, overpayments as credit). This happens once.
        </p>
        {opening.rows.length === 0 ? (
          <Notice tone="success">No opening balances waiting.</Notice>
        ) : (
          <>
            <p className="text-sm">
              {opening.rows.length} waiting: {kes(opening.owedCents)} owed,{" "}
              {kes(opening.creditCents)} in credit.
            </p>
            {!opening.arrears ? (
              <Notice tone="error">Set up vote heads first (Fee setup).</Notice>
            ) : null}
            <ActionForm
              action={postOpeningBalancesAction}
              submitLabel={`Post ${opening.rows.length} opening balances`}
              pendingLabel="Posting…"
            />
          </>
        )}
      </Card>

      <Card>
        <ActionForm action={addChargeAction} submitLabel="Add charge" variant="secondary">
          <h2 className="font-heading text-lg font-bold">One-off charge</h2>
          <p className="text-sm text-ink/70">
            A trip, damage, a replacement uniform: added to one student&apos;s account.
          </p>
          <Field label="Admission number" name="admissionNumber" id="charge-adm" required />
          <Field label="What for" name="description" placeholder="Trip to Fort Jesus" required />
          <Field label="Amount (KES)" name="amount" id="charge-amt" inputMode="decimal" required />
          <Select
            label="Vote head"
            name="voteHeadId"
            options={setup.voteHeads.map((v) => ({ value: v.id, label: v.name }))}
          />
          <Select label="Term" name="termId" placeholder="No particular term" options={terms} />
        </ActionForm>
      </Card>
    </div>
  );
}
