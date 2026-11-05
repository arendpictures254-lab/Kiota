import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { day } from "@/lib/i18n";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { childNotices, sections } from "@/lib/portal/service";
import { markReadAction } from "../../actions";
import { ParentShell } from "../../parent-shell";

export const metadata: Metadata = { title: "Notices · Kiota" };

export default function NoticesPage({ params }: PageProps<"/parent/[linkId]/notices">) {
  return (
    <Suspense fallback={<Loading />}>
      <Notices params={params} />
    </Suspense>
  );
}

async function Notices({ params }: Pick<PageProps<"/parent/[linkId]/notices">, "params">) {
  const { linkId } = await params;
  const { user, children, child, isStaff, t, locale } = await requireChild(linkId);
  if (!sections(child).notices) notFound();
  const notices = await childNotices(portalDeps, user.id, linkId);

  return (
    <ParentShell
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={t("notices.title")}
      back={{ href: `/parent/${linkId}`, label: child.firstName }}
    >
      <p className="-mt-3 text-sm text-ink/60">{child.schoolName}</p>
      {notices.length === 0 ? <p className="text-ink/60">{t("notices.none")}</p> : null}
      <ul className="flex flex-col gap-3">
        {notices.map((n) => (
          <li
            key={n.id}
            className={`flex flex-col gap-2 rounded-2xl border p-4 ${
              n.readAt ? "border-ink/10 bg-white" : "border-teal/40 bg-egg-blue/15"
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink/60">{day(n.sentAt, locale)}</span>
              <span className="flex gap-1">
                {n.critical ? (
                  <span className="rounded-full bg-status-overdue px-2 py-0.5 text-xs font-bold text-white">
                    {t("notices.urgent")}
                  </span>
                ) : null}
                {!n.readAt ? (
                  <span className="rounded-full bg-teal px-2 py-0.5 text-xs font-bold text-white">
                    {t("notices.new")}
                  </span>
                ) : null}
              </span>
            </div>
            <p className="whitespace-pre-line text-ink">{n.body}</p>
            {!n.readAt ? (
              <form action={markReadAction}>
                <input type="hidden" name="linkId" value={linkId} />
                <input type="hidden" name="campaignId" value={n.id} />
                <button type="submit" className="h-11 text-sm font-semibold text-teal">
                  {t("notices.markRead")}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </ParentShell>
  );
}
