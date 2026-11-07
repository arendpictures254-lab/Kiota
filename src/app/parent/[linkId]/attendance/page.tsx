import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttendanceCalendar } from "@/components/attendance-calendar";
import { Loading } from "@/components/ui";
import { portalDeps, requireChild } from "@/lib/portal/context";
import { childAttendance, sections } from "@/lib/portal/service";
import { calendarLabels } from "../../calendar-labels";
import { ParentShell } from "../../parent-shell";

export const metadata: Metadata = { title: "Attendance · Kiota" };

export default function AttendancePage({ params }: PageProps<"/parent/[linkId]/attendance">) {
  return (
    <Suspense fallback={<Loading />}>
      <Attendance params={params} />
    </Suspense>
  );
}

async function Attendance({ params }: Pick<PageProps<"/parent/[linkId]/attendance">, "params">) {
  const { linkId } = await params;
  const { user, children, child, isStaff, t } = await requireChild(linkId);
  if (!sections(child).attendance) notFound();
  const a = await childAttendance(portalDeps, user.id, linkId);
  if (!a) notFound();
  return (
    <ParentShell
      width="reading"
      t={t}
      kids={children}
      current={linkId}
      isStaff={isStaff}
      title={t("att.title", { child: child.firstName })}
      back={{ href: `/parent/${linkId}`, label: child.firstName }}
    >
      <p className="-mt-3 text-sm text-ink/60">
        {child.schoolName} ·{" "}
        {a.term ? t("att.thisTerm", { term: `${a.term.name} ${a.term.year}` }) : t("att.period")}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["att.percent", a.percent === null ? "—" : `${a.percent}%`],
            ["att.daysAbsent", String(a.daysAbsent + a.partDays)],
            ["att.lates", String(a.lates)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-ink/10 bg-white p-3">
            <dt className="text-xs text-ink/60">{t(k)}</dt>
            <dd className="font-heading text-2xl font-bold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {a.days.length ? (
        <div className="rounded-2xl border border-ink/10 bg-white p-4">
          <AttendanceCalendar
            days={a.days}
            from={a.period.from}
            to={a.period.to}
            labels={calendarLabels(t)}
          />
        </div>
      ) : (
        <p className="text-ink/60">{t("att.none")}</p>
      )}
      <p className="text-sm text-ink/60">{t("att.explain")}</p>
    </ParentShell>
  );
}
