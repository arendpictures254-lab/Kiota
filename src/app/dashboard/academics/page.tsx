import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { myMarkSheets } from "@/lib/academics/marks";
import { RESULT_STATUS, resultsOverview } from "@/lib/academics/results";
import { termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { AcademicsShell, STATUS_TONE, TermPicker, loadAcademicsActor, one } from "./shared";

export const metadata: Metadata = { title: "Academics · Kiota" };

type Props = PageProps<"/dashboard/academics">;

export default function AcademicsPage({ searchParams }: Props) {
  return (
    <AcademicsShell title="Academics" back={{ href: "/dashboard", label: "Home" }}>
      <Suspense fallback={<Loading />}>
        <Hub searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

async function Hub({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAcademicsActor();
  const p = actor.permissions;
  const { terms, term } = await termChoice(deps, actor, one((await searchParams).term));
  if (!term)
    return (
      <Notice tone="info">
        No terms yet.{" "}
        {p.has("structure.manage")
          ? "Add the school year and its terms in School setup."
          : "Ask the school office to add the terms."}
      </Notice>
    );
  const [sheets, streams] = await Promise.all([
    p.has("marks.enter") ? myMarkSheets(deps, actor, term.id) : Promise.resolve([]),
    resultsOverview(deps, actor, term.id),
  ]);
  const q = `term=${term.id}`;
  return (
    <div className="flex flex-col gap-6">
      <TermPicker
        terms={terms}
        current={term.id}
        href={(id) => `/dashboard/academics?term=${id}`}
      />

      {sheets.length ? (
        <section aria-labelledby="my-sheets" className="flex flex-col gap-3">
          <h2 id="my-sheets" className="text-section font-bold">
            My mark sheets
          </h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
            {sheets.map((s) => {
              const done = s.assessments.filter((a) => a.submitted).length;
              return (
                <li key={`${s.streamId}-${s.subjectId}`}>
                  <Link
                    href={`/dashboard/academics/marks/${s.streamId}/${s.subjectId}?${q}`}
                    className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 font-semibold text-ink">
                        {s.subject} · {s.stream}
                      </span>
                      {s.status !== "draft" ? (
                        <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold text-ink/70">
                          Locked
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-ink/60">
                      {s.assessments.length === 0
                        ? "No assessments set for this term yet"
                        : s.assessments
                            .map(
                              (a) =>
                                `${a.name}: ${a.submitted ? "submitted" : `${a.entered} of ${s.students}`}`,
                            )
                            .join(" · ")}
                    </span>
                    {s.assessments.length ? (
                      <span
                        className={`text-sm font-semibold ${done === s.assessments.length ? "text-status-paid" : "text-ink/70"}`}
                      >
                        {done} of {s.assessments.length} submitted
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : p.has("marks.enter") && !p.has("results.approve") ? (
        <p className="text-ink/60">
          You have no subjects to mark this term. The Director of Studies assigns subjects to
          teachers.
        </p>
      ) : null}

      {streams.length ? (
        <section aria-labelledby="results" className="flex flex-col gap-3">
          <h2 id="results" className="text-section font-bold">
            {p.has("results.approve") ? "Results by stream" : "My stream"}
          </h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4 [&>li]:min-w-0 [&>li>*]:h-full">
            {streams.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/academics/results/${s.id}?${q}`}
                  className="flex flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 font-semibold text-ink">{s.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[s.status]}`}
                    >
                      {RESULT_STATUS[s.status]}
                    </span>
                  </span>
                  <span className="text-sm text-ink/60">
                    {!s.hasAssessments
                      ? "No assessments set"
                      : s.subjects
                        ? `${s.complete} of ${s.subjects} subjects complete`
                        : "No subjects assigned to teachers"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {p.has("academics.setup") ? (
        <section aria-labelledby="setup" className="flex flex-col gap-3">
          <h2 id="setup" className="text-section font-bold">
            Set up
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [
                "/dashboard/academics/setup/assessments",
                "Assessments and weights",
                "CATs, mid-term, end-term, per term and level",
              ],
              [
                "/dashboard/academics/setup/teaching",
                "Teaching assignments",
                "Who teaches which subject in each stream",
              ],
              [
                "/dashboard/academics/setup",
                "Grading and report cards",
                "Grading schemes, positions, template, competencies",
              ],
              [
                "/dashboard/academics/setup/comments",
                "Comment bank",
                "Suggested comments per level",
              ],
            ].map(([href, title, sub]) => (
              <li key={href}>
                <Link
                  href={`${href}?${q}`}
                  className="flex h-full flex-col gap-1 rounded-2xl border border-ink/10 bg-white p-4 hover:border-teal/40"
                >
                  <span className="font-semibold text-teal">{title}</span>
                  <span className="text-sm text-ink/60">{sub}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
