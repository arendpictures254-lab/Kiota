import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GatePass } from "@/components/gate-pass";
import { Loading, Notice } from "@/components/ui";
import { parentLeaveouts } from "@/lib/leaveout/parent";
import { passQrSvg } from "@/lib/leaveout/qr";
import { whenText } from "@/lib/leaveout/rules";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { ParentShell } from "../../../parent-shell";

export const metadata: Metadata = { title: "Gate pass · Kiota", robots: { index: false } };

/** The digital gate pass a parent shows at the gate (the same QR code as the printed one). */
export default function ParentPassPage({ params }: PageProps<"/parent/[linkId]/leaveouts/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Pass params={params} />
    </Suspense>
  );
}

async function Pass({ params }: Pick<PageProps<"/parent/[linkId]/leaveouts/[id]">, "params">) {
  const { linkId, id } = await params;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  const l = (await parentLeaveouts(portalDeps, user.id, linkId)).find((x) => x.id === id);
  if (!l || !l.passToken) notFound();
  return (
    <ParentShell
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      back={{ href: `/parent/${linkId}/leaveouts`, label: t("lo.title") }}
    >
      <Notice>{t("lo.passHint")}</Notice>
      <GatePass
        p={{
          schoolName: child.schoolName,
          crestDataUrl: null,
          studentName: l.studentName,
          classLabel: l.classLabel,
          admissionNumber: l.admissionNumber,
          photoUrl: child.hasPhoto ? `/parent/photo/${linkId}` : null,
          leave: whenText(l.leaveAt, locale),
          back: whenText(l.returnAt, locale),
          collector: `${l.collectorName} (${l.collectorRelationship})`,
          approvedBy: null,
          reason: l.reason,
          qrSvg: await passQrSvg(l.passToken),
          labels: {
            title: t("lo.passTitle"),
            leaves: t("lo.leaves"),
            back: t("lo.back"),
            collector: t("lo.collector"),
            reason: t("lo.reason"),
          },
        }}
      />
    </ParentShell>
  );
}
