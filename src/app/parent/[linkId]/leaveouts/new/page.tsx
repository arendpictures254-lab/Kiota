import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { pick } from "@/lib/i18n";
import { parentCollectors, parentReasons } from "@/lib/leaveout/parent";
import { toNairobiInput } from "@/lib/leaveout/rules";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { sections } from "@/lib/portal/service";
import { ParentShell } from "../../../parent-shell";
import { ParentRequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request a leave-out · Kiota" };

export default function ParentNewLeaveoutPage({
  params,
}: PageProps<"/parent/[linkId]/leaveouts/new">) {
  return (
    <Suspense fallback={<Loading />}>
      <NewRequest params={params} />
    </Suspense>
  );
}

async function NewRequest({ params }: Pick<PageProps<"/parent/[linkId]/leaveouts/new">, "params">) {
  const { linkId } = await params;
  const { user, children, child, isStaff, t } = await requireChild(linkId);
  if (!sections(child).leaveOuts) notFound();
  const [collectors, reasons] = await Promise.all([
    parentCollectors(portalDeps, user.id, linkId),
    parentReasons(portalDeps, user.id, linkId),
  ]);
  const start = new Date(new Date().getTime() + 24 * 3600_000);
  start.setUTCHours(11, 0, 0, 0); // 14:00 Nairobi
  return (
    <ParentShell
      width="form"
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={t("lo.request")}
      back={{ href: `/parent/${linkId}/leaveouts`, label: t("lo.title") }}
    >
      <ParentRequestForm
        linkId={linkId}
        reasons={reasons}
        collectors={collectors.map((c) => ({
          id: c.link_id,
          label: `${c.name} (${c.relationship})`,
        }))}
        defaultLeave={toNairobiInput(start)}
        defaultReturn={toNairobiInput(new Date(start.getTime() + 2 * 86_400_000 + 3 * 3600_000))}
        text={{
          ...pick(t, [
            "lo.reason",
            "lo.details",
            "lo.leaves",
            "lo.back",
            "lo.who",
            "lo.someoneElse",
            "lo.otherName",
            "lo.otherPhone",
            "lo.otherHint",
            "lo.send",
            "lo.sending",
          ]),
          otherRelationship: t("lo.otherRelationship", { child: child.firstName }),
        }}
      />
    </ParentShell>
  );
}
