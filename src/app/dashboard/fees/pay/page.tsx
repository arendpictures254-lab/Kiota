import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Loading, Notice, Select } from "@/components/ui";
import { deps } from "@/lib/actions";
import { withContext } from "@/lib/db-core";
import { kes } from "@/lib/fees/allocation";
import { studentPosition } from "@/lib/fees/ledger";
import { ctxOf } from "@/lib/service-kit";
import { recordPaymentAction } from "../actions";
import { FeesShell, loadFeesActor, todayIso } from "../shared";

export const metadata: Metadata = { title: "Record a payment · Kiota" };

export default function PayPage({ searchParams }: PageProps<"/dashboard/fees/pay">) {
  return (
    <FeesShell title="Record a payment">
      <Suspense fallback={<Loading />}>
        <Pay searchParams={searchParams} />
      </Suspense>
    </FeesShell>
  );
}

async function Pay({ searchParams }: Pick<PageProps<"/dashboard/fees/pay">, "searchParams">) {
  const { actor } = await loadFeesActor("fees.collect");
  const { student } = await searchParams;
  const pre =
    typeof student === "string" && /^[0-9a-f-]{36}$/i.test(student)
      ? await withContext(deps.db, ctxOf(actor), async (tx) => {
          const s = await tx.student.findUnique({
            where: { schoolId: actor.schoolId, id: student },
          });
          return s
            ? { s, balance: (await studentPosition(tx, actor.schoolId, s.id)).balanceCents }
            : null;
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      {pre ? (
        <Notice>
          {pre.s.firstName} {pre.s.lastName} ({pre.s.admissionNumber}): balance {kes(pre.balance)}
        </Notice>
      ) : null}
      <p className="text-ink/70">
        For cash, bank deposits and cheques. M-Pesa payments arrive by themselves.
      </p>
      <ActionForm
        action={recordPaymentAction}
        submitLabel="Save and issue receipt"
        pendingLabel="Saving…"
      >
        <Field
          label="Admission number"
          name="admissionNumber"
          defaultValue={pre?.s.admissionNumber}
          required
          autoComplete="off"
        />
        <Field
          label="Amount (KES)"
          name="amount"
          inputMode="decimal"
          placeholder="12500"
          required
        />
        <Select
          label="How was it paid?"
          name="method"
          options={[
            { value: "cash", label: "Cash" },
            { value: "bank", label: "Bank deposit" },
            { value: "cheque", label: "Cheque" },
          ]}
        />
        <Field
          label="Reference"
          name="reference"
          hint="Bank slip or cheque number. Optional for cash."
        />
        <Field label="Paid by" name="payerName" hint="Optional" autoComplete="off" />
        <Field label="Payer's phone" name="payerPhone" type="tel" hint="Optional" />
        <Field
          label="Date paid"
          name="paidAt"
          type="date"
          defaultValue={todayIso()}
          max={todayIso()}
          required
        />
      </ActionForm>
    </div>
  );
}
