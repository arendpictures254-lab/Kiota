import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { formatPhone } from "@/lib/phone";
import { whenText } from "@/lib/leaveout/rules";
import { canApproveLeaveouts, getLeaveout } from "@/lib/leaveout/service";
import { approveLeaveoutAction, cancelLeaveoutAction, declineLeaveoutAction } from "../actions";
import { LeaveoutsShell, StatusPill, loadLeaveoutActor } from "../shared";

export const metadata: Metadata = { title: "Leave-out · Kiota" };

export default function LeaveoutPage({
  params,
  searchParams,
}: PageProps<"/dashboard/leaveouts/[id]">) {
  return (
    <LeaveoutsShell>
      <Suspense fallback={<Loading />}>
        <Leaveout params={params} searchParams={searchParams} />
      </Suspense>
    </LeaveoutsShell>
  );
}

async function Leaveout({ params, searchParams }: PageProps<"/dashboard/leaveouts/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const isNew = sp.new;
  const done = sp.done;
  const { actor } = await loadLeaveoutActor();
  const l = await getLeaveout(deps, actor, id);
  if (!l) notFound();
  const approver = canApproveLeaveouts(actor.permissions);
  const mayCancel =
    ["awaiting_parent", "pending", "approved"].includes(l.status) &&
    (approver || actor.permissions.has("boarding.manage") || l.requestedById === actor.userId);

  const steps: [string, string | null, Date | null][] = [
    [
      `Requested${l.requestedVia === "parent" ? " by a parent" : l.requestedVia === "bulk" ? " (half term)" : ""}`,
      l.requestedBy,
      l.createdAt,
    ],
    ...(l.collectorKind === "other"
      ? ([[`Collector approved by the parent`, null, l.collectorApprovedAt]] as [
          string,
          string | null,
          Date | null,
        ][])
      : []),
    [l.status === "declined" ? "Declined" : "Approved", l.approvedBy, l.decidedAt],
    ["Cancelled", l.cancelledBy, l.cancelledAt],
    ["Left through the gate", l.exitBy, l.exitedAt],
    ["Back", l.returnBy, l.returnedAt],
  ];

  return (
    <div className="flex flex-col gap-5">
      {done === "approved" ? (
        <Notice tone="success">
          Approved. The collector has their pickup code by SMS, and the parents are told.
        </Notice>
      ) : null}
      {done === "declined" ? (
        <Notice tone="success">Declined. The parents have been told why.</Notice>
      ) : null}
      {isNew ? (
        <Notice tone="success">
          {l.status === "awaiting_parent"
            ? "Sent. The parents were asked by SMS to approve the collector; then it goes for approval."
            : "Sent for approval."}
        </Notice>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">{l.studentName}</h1>
          <p className="text-sm text-ink/60">
            {l.admissionNumber} · {l.classLabel}
          </p>
        </div>
        <StatusPill status={l.status} />
      </div>

      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink/60">Reason</dt>
          <dd>
            {l.reason}
            {l.details ? `: ${l.details}` : ""}
          </dd>
          <dt className="text-ink/60">Leaves</dt>
          <dd className="font-semibold">{whenText(l.leaveAt)}</dd>
          <dt className="text-ink/60">Back by</dt>
          <dd className="font-semibold">{whenText(l.returnAt)}</dd>
          <dt className="text-ink/60">Collector</dt>
          <dd>
            {l.collectorName} ({l.collectorRelationship}) · {formatPhone(l.collectorPhone)}
            {l.collectorKind === "other" ? " · not a listed guardian" : ""}
          </dd>
          {l.declineReason ? (
            <>
              <dt className="text-ink/60">Why declined</dt>
              <dd>{l.declineReason}</dd>
            </>
          ) : null}
          {l.cancelReason ? (
            <>
              <dt className="text-ink/60">Why cancelled</dt>
              <dd>{l.cancelReason}</dd>
            </>
          ) : null}
        </dl>
      </Card>

      {["approved", "out"].includes(l.status) && l.passToken ? (
        <ButtonLink href={`/dashboard/leaveouts/${l.id}/pass`}>Print the gate pass</ButtonLink>
      ) : null}

      {approver && l.status === "pending" ? (
        <section className="flex flex-col gap-3">
          <ActionForm
            action={approveLeaveoutAction}
            submitLabel="Approve"
            pendingLabel="Approving…"
          >
            <input type="hidden" name="id" value={l.id} />
          </ActionForm>
          <ActionForm
            action={declineLeaveoutAction}
            submitLabel="Decline"
            pendingLabel="Declining…"
            variant="danger"
          >
            <input type="hidden" name="id" value={l.id} />
            <Field label="Reason for declining (the parents see it)" name="reason" required />
          </ActionForm>
        </section>
      ) : null}
      {approver && l.status === "awaiting_parent" ? (
        <section className="flex flex-col gap-3">
          <Notice>
            Waiting for a parent to approve {l.collectorName} as the collector (SMS reply or the
            parent portal).
          </Notice>
          <ActionForm
            action={declineLeaveoutAction}
            submitLabel="Decline"
            pendingLabel="Declining…"
            variant="danger"
          >
            <input type="hidden" name="id" value={l.id} />
            <Field label="Reason for declining (the parents see it)" name="reason" required />
          </ActionForm>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Who did what</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {steps
            .filter(([, , at]) => at)
            .map(([what, who, at]) => (
              <li key={what} className="flex justify-between gap-3 border-b border-ink/5 py-1">
                <span>
                  {what}
                  {who ? ` · ${who}` : ""}
                </span>
                <span className="text-ink/60">{whenText(at!)}</span>
              </li>
            ))}
        </ol>
        {l.events.some((e) => e.conflict) ? (
          <Notice tone="error">
            {l.events
              .filter((e) => e.conflict)
              .map((e) => `Gate ${e.kind}${e.offline ? " (offline)" : ""}: ${e.conflict}`)
              .join(" ")}
          </Notice>
        ) : null}
      </section>

      {mayCancel ? (
        <ActionForm
          action={cancelLeaveoutAction}
          submitLabel="Cancel this leave-out"
          variant="secondary"
          pendingLabel="Cancelling…"
        >
          <input type="hidden" name="id" value={l.id} />
          <Field label="Why (optional)" name="reason" />
        </ActionForm>
      ) : null}
    </div>
  );
}
