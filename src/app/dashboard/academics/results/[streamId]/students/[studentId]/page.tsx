import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Loading, Notice } from "@/components/ui";
import { studentReportExtras } from "@/lib/academics/comments";
import { formatHundredths, formatTenths } from "@/lib/academics/grading";
import { termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { reportExtrasAction } from "../../../../actions";
import { AcademicsShell, loadAcademicsActor, one } from "../../../../shared";
import { CommentField } from "./comment-field";

export const metadata: Metadata = { title: "Student report · Kiota" };

type Props = PageProps<"/dashboard/academics/results/[streamId]/students/[studentId]">;

export default function StudentReportPage({ params, searchParams }: Props) {
  return (
    <AcademicsShell width="form">
      <Suspense fallback={<Loading />}>
        <StudentReport params={params} searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

async function StudentReport({ params, searchParams }: Props) {
  const { actor } = await loadAcademicsActor();
  const { streamId, studentId } = await params;
  const { term } = await termChoice(deps, actor, one((await searchParams).term));
  if (!term) notFound();
  const x = await studentReportExtras(deps, actor, term.id, streamId, studentId).catch(() => null);
  if (!x) notFound();
  const s = x.student;
  const base = `/dashboard/academics/results/${streamId}/students`;
  const q = `term=${term.id}`;
  const canRate = x.canClassTeacher;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold">
          {s.firstName} {s.lastName}
        </h1>
        <p className="text-sm text-ink/70">
          {s.admissionNumber} · {x.results.stream.name} · {term.label}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:grid-cols-4">
        {[
          [
            "Mean score",
            s.summary.meanTenths !== null ? `${formatTenths(s.summary.meanTenths)}%` : "–",
          ],
          [
            "Mean points",
            s.summary.meanPointsHundredths !== null
              ? formatHundredths(s.summary.meanPointsHundredths)
              : "–",
          ],
          ["Overall", s.summary.meanGrade ?? "–"],
          [
            "Position",
            s.streamPosition ? `${s.streamPosition} of ${x.results.streamSize}` : "Not shown",
          ],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <span className="text-xs text-ink/60">{k}</span>
            <span className="font-heading text-lg font-bold text-teal">{v}</span>
          </div>
        ))}
      </div>

      {x.results.status === "released" ? (
        <Notice>Released: comments and ratings are final.</Notice>
      ) : null}

      <ActionForm action={reportExtrasAction} submitLabel="Save" wide>
        <input type="hidden" name="termId" value={term.id} />
        <input type="hidden" name="streamId" value={streamId} />
        <input type="hidden" name="studentId" value={studentId} />
        {x.canClassTeacher || x.classTeacherComment ? (
          x.canClassTeacher ? (
            <CommentField
              name="classTeacherComment"
              label="Class teacher's comment"
              initial={x.classTeacherComment}
              suggestions={x.suggestions.class_teacher}
            />
          ) : (
            <p className="text-sm">
              <b>Class teacher:</b> {x.classTeacherComment}
            </p>
          )
        ) : null}
        {x.canPrincipal ? (
          <CommentField
            name="principalComment"
            label="Principal's comment"
            initial={x.principalComment}
            suggestions={x.suggestions.principal}
          />
        ) : x.principalComment ? (
          <p className="text-sm">
            <b>Principal:</b> {x.principalComment}
          </p>
        ) : null}

        {x.competencies.length ? (
          <fieldset className="flex flex-col gap-3" disabled={!canRate}>
            {canRate ? <input type="hidden" name="ratings" value="1" /> : null}
            <legend className="text-section font-bold">Competencies and values</legend>
            <p className="text-sm text-ink/70">
              {x.rubric.map((l) => `${l.code} ${l.label}`).join(" · ")}
            </p>
            {(["competency", "value"] as const).map((kind) => (
              <div key={kind} className="flex flex-col gap-2">
                <h3 className="text-sm font-bold text-teal">
                  {kind === "competency" ? "Core competencies" : "Values"}
                </h3>
                {x.competencies
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <div
                      key={c.id}
                      role="radiogroup"
                      aria-label={c.name}
                      className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-sm font-semibold">{c.name}</span>
                      <span className="grid grid-cols-4 gap-1.5 sm:w-64">
                        {[...x.rubric]
                          .sort((a, b) => b.points - a.points)
                          .map((l) => (
                            <label
                              key={l.code}
                              title={l.label}
                              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-ink/15 bg-white text-sm font-bold has-checked:border-teal has-checked:bg-teal has-checked:text-white"
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name={`rating:${c.id}`}
                                value={l.points}
                                defaultChecked={x.ratings[c.id] === l.points}
                                aria-label={`${c.name}: ${l.label}`}
                              />
                              {l.code}
                            </label>
                          ))}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
          </fieldset>
        ) : null}
      </ActionForm>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ButtonLink
          href={`/dashboard/academics/report/${streamId}/${studentId}?${q}`}
          variant="secondary"
        >
          Preview report card
        </ButtonLink>
      </div>
      <nav aria-label="Other students" className="flex justify-between gap-2 text-sm font-semibold">
        {x.previous ? (
          <Link
            className="inline-flex min-h-11 items-center text-teal"
            href={`${base}/${x.previous}?${q}`}
          >
            ← Previous student
          </Link>
        ) : (
          <span />
        )}
        {x.next ? (
          <Link
            className="inline-flex min-h-11 items-center text-teal"
            href={`${base}/${x.next}?${q}`}
          >
            Next student →
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
