import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GatePass } from "@/components/gate-pass";
import { PrintButton } from "@/components/print-button";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { schoolCrest } from "@/lib/fees/receipts";
import { passQrSvg } from "@/lib/leaveout/qr";
import { whenText } from "@/lib/leaveout/rules";
import { getLeaveout } from "@/lib/leaveout/service";
import { LeaveoutsShell, loadLeaveoutActor } from "../../shared";

export const metadata: Metadata = { title: "Gate pass · Kiota" };

export default function PassPage({ params }: PageProps<"/dashboard/leaveouts/[id]/pass">) {
  return (
    <LeaveoutsShell>
      {/* A5 when printed. */}
      <style>{`@media print { @page { size: A5; margin: 10mm } }`}</style>
      <Suspense fallback={<Loading />}>
        <Pass params={params} />
      </Suspense>
    </LeaveoutsShell>
  );
}

async function Pass({ params }: Pick<PageProps<"/dashboard/leaveouts/[id]/pass">, "params">) {
  const { id } = await params;
  const { actor } = await loadLeaveoutActor();
  const l = await getLeaveout(deps, actor, id);
  if (!l) notFound();
  if (!l.passToken || !["approved", "out"].includes(l.status)) {
    return <Notice tone="error">This leave-out has no valid pass ({l.status}).</Notice>;
  }
  const crest = await schoolCrest(l.school.logoUrl, l.school.id);
  return (
    <div className="flex flex-col gap-4">
      <GatePass
        p={{
          schoolName: l.school.name,
          crestDataUrl: crest
            ? `data:${crest.contentType};base64,${crest.bytes.toString("base64")}`
            : null,
          studentName: l.studentName,
          classLabel: l.classLabel,
          admissionNumber: l.admissionNumber,
          photoUrl: l.photoKey ? `/files/leaveouts/${l.id}/photo` : null,
          leave: whenText(l.leaveAt),
          back: whenText(l.returnAt),
          collector: `${l.collectorName} (${l.collectorRelationship})`,
          approvedBy: l.approvedBy,
          reason: l.reason,
          qrSvg: await passQrSvg(l.passToken),
        }}
      />
      <div className="print:hidden">
        <PrintButton label="Print pass (A5)" />
      </div>
    </div>
  );
}
