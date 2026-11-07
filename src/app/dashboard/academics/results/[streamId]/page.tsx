import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Loading, Notice, TextArea } from "@/components/ui";
import { formatHundredths, formatTenths } from "@/lib/academics/grading";
import { RESULT_STATUS, type StreamResultsView, streamResults } from "@/lib/academics/results";
import { termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { approveAction, releaseAction, sendBackAction, signOffAction } from "../../actions";
import { AcademicsShell, STATUS_TONE, TermPicker, loadAcademicsActor, one } from "../../shared";

export const metadata: Metadata = { title: "Results and sign-off · Kiota" };

type Props = PageProps<"/dashboard/academics/results/[streamId]">;

export default function ResultsPage({ params, searchParams }: Props) {
  return (
    <AcademicsShell>
      <Suspense fallback={<Loading />}>
        <Results params={params} searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

const day = (d: Date) =>
  d.toLocaleDateString("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

async function Results({ params, searchParams }: Props) {
  const { actor } = await loadAcademicsActor();
  const { streamId } = await params;
  const { terms, term } = await termChoice(deps, actor, one((await searchParams).term));
  if (!term) notFound();
  const r = await streamResults(deps, actor, term.id, streamId).catch(() => null);
  if (!r) notFound();
  const q = `term=${term.id}`;
  const hidden = (
    <>
      <input type="hidden" name="termId" value={term.id} />
      <input type="hidden" name="streamId" value={streamId} />
    </>
  );
  const done = r.completeness.filter((c) => c.complete).length;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title font-bold">{r.stream.name}</h1>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_TONE[r.status]}`}>
            {RESULT_STATUS[r.status]}
          </span>
        </div>
        <p className="text-sm text-ink/70">
          {term.label} · class teacher {r.stream.classTeacher ?? "not set"} ·{" "}
          {r.scheme?.name ?? "no grading scheme"}
          {r.showPositions ? " · positions shown" : ""}
        </p>
        <TermPicker
          terms={terms}
          current={term.id}
          href={(id) => `/dashboard/academics/results/${streamId}?term=${id}`}
        />
      </header>

      {r.record?.returnedReason && r.status === "draft" ? (
        <Notice tone="error">Sent back by the approver: {r.record.returnedReason}</Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="complete" className="flex min-w-0 flex-col gap-3">
          <h2 id="complete" className="text-section font-bold">
            Subjects: {done} of {r.completeness.length} complete
          </h2>
          {r.completeness.length === 0 ? (
            <Notice>No subjects are assigned to teachers in this stream yet.</Notice>
          ) : (
            <ul
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3"
              data-testid="completeness"
            >
              {r.completeness.map((c) => (
                <li key={c.subjectId} className="min-w-0">
                  <Link
                    href={`/dashboard/academics/marks/${streamId}/${c.subjectId}?${q}`}
                    className="flex h-full items-center justify-between gap-2 rounded-xl border border-ink/10 bg-white p-3 hover:border-teal/40"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-ink">{c.subject}</span>
                      <span className="truncate text-xs text-ink/60">
                        {c.teacher ?? "No teacher"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${c.complete ? "bg-status-paid/15 text-status-paid" : "bg-status-due/20 text-ink"}`}
                    >
                      {c.complete ? "Complete" : `${c.submitted} of ${c.needed} submitted`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside
          aria-labelledby="next-step"
          className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
        >
          <h2 id="next-step" className="text-section font-bold">
            Next step
          </h2>
          <Steps r={r} />
          {r.can.signOff ? (
            <ActionForm action={signOffAction} submitLabel="Sign off this stream" wide>
              {hidden}
              <p className="text-sm text-ink/70">
                {r.allComplete
                  ? "Every subject is submitted. Signing off locks the marks; after that only the Principal can change one, and each change is logged."
                  : "Waiting for every subject to be submitted."}
              </p>
            </ActionForm>
          ) : null}
          {r.can.approve ? (
            <ActionForm action={approveAction} submitLabel="Approve results" wide>
              {hidden}
            </ActionForm>
          ) : null}
          {r.can.release ? (
            <ActionForm action={releaseAction} submitLabel="Release report cards" wide>
              {hidden}
              <p className="text-sm text-ink/70">
                Releasing is final. Each report card gets a QR code that proves it is genuine.
              </p>
            </ActionForm>
          ) : null}
          {r.can.sendBack ? (
            <details className="rounded-xl border border-ink/10 p-3">
              <summary className="min-h-11 cursor-pointer content-center font-semibold text-teal">
                Send back to the class teacher
              </summary>
              <ActionForm action={sendBackAction} submitLabel="Send back" variant="danger" wide>
                {hidden}
                <TextArea label="What needs fixing?" name="reason" required />
              </ActionForm>
            </details>
          ) : null}
          {r.can.print ? (
            <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
              <ButtonLink
                href={`/dashboard/academics/print/${streamId}?${q}`}
                variant={r.status === "released" ? "primary" : "secondary"}
                prefetch={false}
                wide
              >
                {r.status === "released" ? "Print report cards (PDF)" : "Print drafts (PDF)"}
              </ButtonLink>
              <p className="text-xs text-ink/60">
                One PDF for the stream, in admission-number order.
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      <section aria-labelledby="broadsheet" className="flex min-w-0 flex-col gap-3">
        <h2 id="broadsheet" className="text-section font-bold">
          Results
        </h2>
        <Broadsheet r={r} q={q} />
      </section>
    </div>
  );
}

function Steps({ r }: { r: StreamResultsView }) {
  const steps = [
    ["Marks entered and submitted", r.allComplete || r.status !== "draft", null],
    ["Class teacher signed off", r.status !== "draft", r.record?.signedOffAt],
    ["Approved", r.status === "approved" || r.status === "released", r.record?.approvedAt],
    ["Released", r.status === "released", r.record?.releasedAt],
  ] as const;
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {steps.map(([label, ok, at]) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-hidden
            className={`grid size-5 place-items-center rounded-full text-xs font-bold ${ok ? "bg-status-paid text-white" : "bg-ink/10 text-ink/50"}`}
          >
            {ok ? "✓" : ""}
          </span>
          <span className={ok ? "font-semibold text-ink" : "text-ink/60"}>
            {label}
            {ok && at ? ` · ${day(at)}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

const short = (name: string, code: string | null) =>
  code ||
  (name.split(/\s+/).length > 1
    ? name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 4)
    : name.slice(0, 4));

function Broadsheet({ r, q }: { r: StreamResultsView; q: string }) {
  if (!r.students.length) return <p className="text-ink/60">No students in this stream.</p>;
  const href = (id: string) => `/dashboard/academics/results/${r.stream.id}/students/${id}?${q}`;
  return (
    <>
      {/* From 1024 px: the broadsheet */}
      <div className="hidden overflow-hidden rounded-2xl border border-ink/10 bg-white lg:block">
        <table className="w-full table-fixed border-collapse text-xs" data-testid="broadsheet">
          <thead className="bg-cream">
            <tr>
              <th scope="col" className="w-[17%] px-2 py-2 text-left font-semibold">
                Student
              </th>
              {r.subjects.map((s) => (
                <th
                  key={s.id}
                  scope="col"
                  title={s.name}
                  className="px-1 py-2 text-center font-semibold"
                >
                  {short(s.name, s.code)}
                </th>
              ))}
              <th scope="col" className="px-1 py-2 text-right font-semibold">
                Total
              </th>
              <th scope="col" className="px-1 py-2 text-right font-semibold">
                Mean
              </th>
              <th scope="col" className="px-1 py-2 text-right font-semibold">
                Pts
              </th>
              <th scope="col" className="px-1 py-2 text-center font-semibold">
                Grade
              </th>
              {r.showPositions ? (
                <th scope="col" className="px-1 py-2 text-center font-semibold">
                  Pos
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {r.students.map((s) => (
              <tr key={s.id} className="border-t border-ink/5 hover:bg-egg-blue/10">
                <th scope="row" className="px-2 py-1.5 text-left font-normal">
                  <Link
                    href={href(s.id)}
                    className="block truncate font-semibold text-teal hover:underline"
                  >
                    {s.firstName} {s.lastName}
                  </Link>
                  <span className="text-ink/60">{s.admissionNumber}</span>
                </th>
                {r.subjects.map((sub) => {
                  const x = s.subjects[sub.id];
                  return (
                    <td key={sub.id} className="px-1 py-1.5 text-center tabular-nums">
                      {x ? (
                        x.pctTenths !== null ? (
                          <>
                            <span className="block font-semibold">{formatTenths(x.pctTenths)}</span>
                            <span className="text-ink/60">{x.code}</span>
                          </>
                        ) : (
                          <span className="text-ink/60">
                            {x.status === "exempt" ? "X" : x.status === "absent" ? "Abs" : "–"}
                          </span>
                        )
                      ) : (
                        <span className="text-ink/30">–</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-1 py-1.5 text-right tabular-nums">
                  {s.summary.count ? formatTenths(s.summary.totalTenths) : "–"}
                </td>
                <td className="px-1 py-1.5 text-right font-semibold tabular-nums">
                  {s.summary.meanTenths !== null ? formatTenths(s.summary.meanTenths) : "–"}
                </td>
                <td className="px-1 py-1.5 text-right tabular-nums">
                  {s.summary.meanPointsHundredths !== null
                    ? formatHundredths(s.summary.meanPointsHundredths)
                    : "–"}
                </td>
                <td className="px-1 py-1.5 text-center font-bold text-teal">
                  {s.summary.meanGrade ?? "–"}
                </td>
                {r.showPositions ? (
                  <td className="px-1 py-1.5 text-center tabular-nums">
                    {s.streamPosition ?? "–"}
                    {s.classPosition ? (
                      <span className="block text-ink/60">{s.classPosition} cls</span>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones and tablets: one row per student */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {r.students.map((s) => (
          <li key={s.id}>
            <Link
              href={href(s.id)}
              className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white p-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-ink">
                  {s.firstName} {s.lastName}
                </span>
                <span className="text-xs text-ink/60">
                  {s.admissionNumber}
                  {s.streamPosition ? ` · position ${s.streamPosition} of ${r.streamSize}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-heading text-lg font-bold text-teal">
                  {s.summary.meanGrade ?? "–"}
                </span>
                <span className="text-xs text-ink/60">
                  {s.summary.meanTenths !== null
                    ? `${formatTenths(s.summary.meanTenths)}%`
                    : "no marks"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
