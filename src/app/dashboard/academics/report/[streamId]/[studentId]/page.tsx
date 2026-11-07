import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { ButtonLink, Loading, Notice } from "@/components/ui";
import { reportCards, verifyUrl } from "@/lib/academics/reportcards";
import { termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { AcademicsShell, loadAcademicsActor, one } from "../../../shared";

export const metadata: Metadata = { title: "Report card preview · Kiota" };

type Props = PageProps<"/dashboard/academics/report/[streamId]/[studentId]">;

export default function ReportPreviewPage({ params, searchParams }: Props) {
  return (
    <AcademicsShell title="Report card" width="reading">
      <Suspense fallback={<Loading />}>
        <Preview params={params} searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const kes = (c: number) => `KES ${(Math.abs(c) / 100).toLocaleString("en-KE")}`;

async function Preview({ params, searchParams }: Props) {
  const { actor } = await loadAcademicsActor();
  if (!actor.permissions.has("reports.print"))
    return (
      <Notice tone="error">Report cards are printed by the class teacher and the Principal.</Notice>
    );
  const { streamId, studentId } = await params;
  const { term } = await termChoice(deps, actor, one((await searchParams).term));
  if (!term) notFound();
  const b = await reportCards(deps, actor, { termId: term.id, streamId, studentId }).catch(
    () => null,
  );
  const c = b?.cards[0];
  if (!b || !c) notFound();
  const qr = c.token ? await QRCode.toDataURL(verifyUrl(c.token), { margin: 1, scale: 4 }) : null;
  const modern = b.template === "modern";
  const isKcse = b.scheme?.name.startsWith("KCSE");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <ButtonLink
          href={`/dashboard/academics/print/${streamId}?term=${term.id}&student=${studentId}`}
          prefetch={false}
        >
          Download PDF
        </ButtonLink>
        <ButtonLink
          href={`/dashboard/academics/results/${streamId}/students/${studentId}?term=${term.id}`}
          variant="secondary"
        >
          Edit comments
        </ButtonLink>
      </div>
      <article
        data-testid="report-card"
        aria-label={`Report card: ${c.name}`}
        className={`flex flex-col gap-4 overflow-hidden rounded-2xl border border-ink/10 bg-white ${modern ? "" : "p-4 sm:p-6"}`}
      >
        <header
          className={`flex items-start justify-between gap-4 ${modern ? "bg-teal p-4 text-white sm:p-6" : "border-b border-ink/10 pb-4"}`}
        >
          <div className="flex min-w-0 flex-col">
            <h1
              className={`text-title font-bold [overflow-wrap:anywhere] ${modern ? "text-white" : "text-teal"}`}
            >
              {b.school.name}
            </h1>
            <p className={`text-sm ${modern ? "text-egg-blue" : "text-ink/60"}`}>
              {b.school.county} County
            </p>
            <p className="mt-1 font-semibold">Report card · {b.term.label}</p>
          </div>
          <div
            className={`grid h-24 w-20 shrink-0 place-items-center rounded-lg border text-xs ${modern ? "border-egg-blue/60 text-egg-blue" : "border-ink/15 text-ink/50"}`}
          >
            Photo
          </div>
        </header>
        <div className={`flex flex-col gap-4 ${modern ? "px-4 pb-4 sm:px-6 sm:pb-6" : ""}`}>
          {!b.released ? (
            <p className="rounded-lg bg-status-overdue/10 p-2 text-center text-sm font-bold text-status-overdue">
              Draft: not released
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ["Name", c.name],
              ["Admission no.", c.admissionNumber],
              ["Class", b.stream.name],
              ["Boarding", c.boarder ? "Boarder" : "Day scholar"],
              ["Class teacher", b.stream.classTeacher ?? "–"],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-ink/60">{k}</dt>
                <dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className={modern ? "bg-egg-blue/50" : "bg-teal text-white"}>
                <th scope="col" className="w-[38%] px-2 py-1.5 text-left">
                  Subject
                </th>
                <th scope="col" className="px-2 py-1.5 text-right">
                  Score
                </th>
                <th scope="col" className="px-2 py-1.5 text-center">
                  {isKcse ? "Grade" : "Level"}
                </th>
                <th scope="col" className="hidden px-2 py-1.5 text-left sm:table-cell sm:w-[34%]">
                  Remarks
                </th>
                <th scope="col" className="px-2 py-1.5 text-center">
                  Tr.
                </th>
              </tr>
            </thead>
            <tbody>
              {c.subjects.map((s) => (
                <tr key={s.name} className="border-b border-ink/10 even:bg-cream/50">
                  <th
                    scope="row"
                    className="px-2 py-1.5 text-left font-normal [overflow-wrap:anywhere]"
                  >
                    {s.name}
                  </th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.score}</td>
                  <td className="px-2 py-1.5 text-center font-bold">{s.code}</td>
                  <td className="hidden px-2 py-1.5 text-ink/70 sm:table-cell">{s.comment}</td>
                  <td className="px-2 py-1.5 text-center text-ink/70">{s.initials}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl
            className={`grid grid-cols-2 gap-3 rounded-xl p-3 sm:grid-cols-4 ${modern ? "bg-cream" : "border border-ink/10"}`}
          >
            {[
              ["Total", `${c.total} / ${c.outOf}`],
              ["Mean score", c.mean === "–" ? "–" : `${c.mean}%`],
              ["Mean points", c.meanPoints],
              [isKcse ? "Mean grade" : "Overall", c.meanGrade],
              ...(b.showPositions
                ? [
                    [
                      "Stream position",
                      c.streamPosition ? `${c.streamPosition} of ${b.streamSize}` : "–",
                    ],
                    [
                      "Class position",
                      c.classPosition ? `${c.classPosition} of ${b.classSize}` : "–",
                    ],
                  ]
                : []),
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-ink/60">{k}</dt>
                <dd className="font-heading text-lg font-bold text-teal">{v}</dd>
              </div>
            ))}
          </dl>
          {c.competencies.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(["competency", "value"] as const).map((kind) => (
                <div key={kind}>
                  <h2 className="text-sm font-bold text-teal">
                    {kind === "competency" ? "Core competencies" : "Values"}
                  </h2>
                  <ul className="text-sm">
                    {c.competencies
                      .filter((x) => x.kind === kind)
                      .map((x) => (
                        <li
                          key={x.name}
                          className="flex justify-between gap-2 border-b border-ink/5 py-0.5"
                        >
                          <span className="min-w-0">{x.name}</span>
                          <b title={x.label}>{x.code || "–"}</b>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-sm">
            {c.attendance
              ? `Attendance this term: present at ${c.attendance.present} of ${c.attendance.present + c.attendance.absent} registers. `
              : ""}
            {c.feeBalanceCents !== null
              ? c.feeBalanceCents > 0
                ? `Fee balance: ${kes(c.feeBalanceCents)}. `
                : "Fees: fully paid. "
              : ""}
            {b.nextTermStart ? `Next term opens on ${day(b.nextTermStart)}.` : ""}
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <b className="text-teal">Class teacher:</b> {c.classTeacherComment || "–"}
            </p>
            <p>
              <b className="text-teal">Principal:</b> {c.principalComment || "–"}
            </p>
          </div>
          <footer className="flex items-end justify-between gap-4 border-t border-ink/10 pt-3 text-xs text-ink/60">
            <div className="flex min-w-0 flex-col gap-1">
              {c.token ? (
                <span className="[overflow-wrap:anywhere]">
                  Check it is genuine: {verifyUrl(c.token).replace(/^https?:\/\//, "")}
                </span>
              ) : (
                <span>The verification code is added when the results are released.</span>
              )}
              <span>Powered by kiota</span>
            </div>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="Verification QR code"
                width={84}
                height={84}
                className="shrink-0"
              />
            ) : null}
          </footer>
        </div>
      </article>
    </div>
  );
}
