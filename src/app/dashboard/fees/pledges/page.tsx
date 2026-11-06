import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { kes } from "@/lib/fees/allocation";
import { listPledges } from "@/lib/fees/reports";
import { addPledgeAction, cancelPledgeAction } from "../actions";
import { FeesShell, loadFeesActor, nairobiDay } from "../shared";

export const metadata: Metadata = { title: "Pledges · Kiota" };

const TONE = {
  kept: "bg-status-paid/10 text-status-paid",
  open: "bg-status-due/10 text-status-due",
  broken: "bg-status-overdue/10 text-status-overdue",
  cancelled: "bg-ink/5 text-ink/60",
};

export default function PledgesPage() {
  return (
    <FeesShell title="Pledges">
      <Suspense fallback={<Loading />}>
        <Pledges />
      </Suspense>
    </FeesShell>
  );
}

async function Pledges() {
  const { actor } = await loadFeesActor("fees.collect", "fees.reports");
  const pledges = await listPledges(deps, actor);
  const canEdit = actor.permissions.has("fees.collect");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink/70">
        A parent promises to pay an amount by a date. Kiota marks it kept when payments since the
        promise reach the amount by that date, and broken when the date passes.
      </p>
      {canEdit ? (
        <Card>
          <ActionForm action={addPledgeAction} submitLabel="Record pledge">
            <Field label="Admission number" name="admissionNumber" required />
            <Field label="Amount promised (KES)" name="amount" inputMode="decimal" required />
            <Field label="Promised by (date)" name="dueDate" type="date" required />
            <Field label="Who promised" name="madeBy" placeholder="Mary Otieno (mother)" required />
            <Field label="Note" name="note" hint="Optional" />
          </ActionForm>
        </Card>
      ) : null}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
        {pledges.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-semibold">
                    {p.student ? `${p.student.firstName} ${p.student.lastName}` : "Student"}
                  </span>
                  <span className="block text-sm text-ink/60">
                    {kes(p.amountCents)} by {nairobiDay(p.dueDate)} · {p.madeBy} · paid{" "}
                    {kes(p.paidCents)} since
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${TONE[p.status]}`}
                >
                  {p.status}
                </span>
              </div>
              {canEdit && p.status === "open" ? (
                <ActionForm
                  action={cancelPledgeAction}
                  submitLabel="Cancel pledge"
                  variant="danger"
                >
                  <input type="hidden" name="pledgeId" value={p.id} />
                </ActionForm>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
