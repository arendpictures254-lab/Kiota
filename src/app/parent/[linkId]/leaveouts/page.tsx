import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink, Loading, Notice } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";
import { parentLeaveouts } from "@/lib/leaveout/parent";
import { timeOfDay, whenText } from "@/lib/leaveout/rules";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { sections } from "@/lib/portal/service";
import { ParentShell } from "../../parent-shell";
import { answerCollectorAction, parentCancelAction } from "./actions";

export const metadata: Metadata = { title: "Leave-outs · Kiota" };

export default function ParentLeaveoutsPage({
  params,
  searchParams,
}: PageProps<"/parent/[linkId]/leaveouts">) {
  return (
    <Suspense fallback={<Loading />}>
      <Leaveouts params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Leaveouts({ params, searchParams }: PageProps<"/parent/[linkId]/leaveouts">) {
  const { linkId } = await params;
  const sent = (await searchParams).sent;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  if (!sections(child).leaveOuts) notFound();
  const list = await parentLeaveouts(portalDeps, user.id, linkId);

  return (
    <ParentShell
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={t("lo.title")}
      back={{ href: `/parent/${linkId}`, label: child.firstName }}
    >
      {sent ? <Notice tone="success">{t("lo.sent")}</Notice> : null}
      <ButtonLink href={`/parent/${linkId}/leaveouts/new`}>{t("lo.request")}</ButtonLink>
      {list.length === 0 ? <p className="text-ink/60">{t("lo.none")}</p> : null}
      <ul className="flex flex-col gap-3">
        {list.map((l) => (
          <li
            key={l.id}
            className="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
            data-testid="parent-leaveout"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{l.reason}</span>
              <span className="text-sm font-semibold text-teal">
                {t(`lo.status.${l.status}` as MessageKey)}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <dt className="text-ink/60">{t("lo.leaves")}</dt>
              <dd>{whenText(l.leaveAt, locale)}</dd>
              <dt className="text-ink/60">{t("lo.back")}</dt>
              <dd>{whenText(l.returnAt, locale)}</dd>
              <dt className="text-ink/60">{t("lo.collector")}</dt>
              <dd>
                {l.collectorName} ({l.collectorRelationship})
              </dd>
            </dl>
            {l.exitedAt ? (
              <p className="text-sm text-ink/70">
                {t("lo.left", { time: whenText(l.exitedAt, locale) })}
              </p>
            ) : null}
            {l.returnedAt ? (
              <p className="text-sm text-ink/70">
                {t("lo.returnedAt", { time: timeOfDay(l.returnedAt) })}
              </p>
            ) : null}
            {l.declineReason ? (
              <p className="text-sm text-status-overdue">
                {t("lo.declinedWhy", { reason: l.declineReason })}
              </p>
            ) : null}
            {l.status === "awaiting_parent" ? (
              <div className="flex flex-col gap-2 rounded-xl bg-status-due/10 p-3">
                <p className="text-sm font-semibold">
                  {t("lo.approveCollector", { collector: l.collectorName, child: child.firstName })}
                </p>
                <div className="flex gap-2">
                  {(["1", "0"] as const).map((yes) => (
                    <form key={yes} action={answerCollectorAction} className="flex-1">
                      <input type="hidden" name="linkId" value={linkId} />
                      <input type="hidden" name="leaveoutId" value={l.id} />
                      <input type="hidden" name="yes" value={yes} />
                      <button
                        type="submit"
                        className={`h-12 w-full rounded-xl font-semibold ${yes === "1" ? "bg-teal text-white" : "border border-ink/20 bg-white"}`}
                      >
                        {yes === "1" ? t("lo.yes") : t("lo.no")}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ) : null}
            {l.passToken ? (
              <Link
                href={`/parent/${linkId}/leaveouts/${l.id}`}
                className="flex h-12 items-center justify-center rounded-xl bg-teal font-semibold text-white"
              >
                {t("lo.showPass")}
              </Link>
            ) : null}
            {["awaiting_parent", "pending", "approved"].includes(l.status) &&
            l.requestedVia === "parent" ? (
              <form action={parentCancelAction}>
                <input type="hidden" name="linkId" value={linkId} />
                <input type="hidden" name="leaveoutId" value={l.id} />
                <button type="submit" className="h-11 text-sm font-semibold text-status-overdue">
                  {t("lo.cancel")}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </ParentShell>
  );
}
