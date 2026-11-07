import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { academicsSetup, assessmentPlan, termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { AcademicsShell, TermPicker, loadAcademicsActor, one } from "../../shared";
import { PlanForm } from "./plan-form";

export const metadata: Metadata = { title: "Assessments · Kiota" };

type Props = PageProps<"/dashboard/academics/setup/assessments">;

export default function AssessmentsPage({ searchParams }: Props) {
  return (
    <AcademicsShell title="Assessments and weights" width="form">
      <Suspense fallback={<Loading />}>
        <Assessments searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

async function Assessments({ searchParams }: Pick<Props, "searchParams">) {
  const { actor } = await loadAcademicsActor();
  if (!actor.permissions.has("academics.setup"))
    return (
      <Notice tone="error">
        Assessments are set up by the Director of Studies or the Principal.
      </Notice>
    );
  const sp = await searchParams;
  const [{ terms, term }, setup] = await Promise.all([
    termChoice(deps, actor, one(sp.term)),
    academicsSetup(deps, actor),
  ]);
  if (!term) return <Notice>Add the school year and its terms in School setup first.</Notice>;
  const level = setup.levels.find((l) => l.id === one(sp.level)) ?? setup.levels[0];
  if (!level) return <Notice>Switch on the levels the school offers in School setup first.</Notice>;
  const plan = await assessmentPlan(deps, actor, term.id, level.id);
  const link = (t: string, l: string) =>
    `/dashboard/academics/setup/assessments?term=${t}&level=${l}`;
  return (
    <div className="flex flex-col gap-5">
      <TermPicker terms={terms} current={term.id} href={(id) => link(id, level.id)} />
      <nav aria-label="Level" className="flex flex-wrap gap-2">
        {setup.levels.map((l) => (
          <Link
            key={l.id}
            href={link(term.id, l.id)}
            aria-current={l.id === level.id ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-full border border-ink/15 bg-white px-4 text-sm font-semibold aria-[current=page]:border-teal aria-[current=page]:bg-teal aria-[current=page]:text-white"
          >
            {l.name}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-ink/70">
        {level.name}, {term.label}. Each assessment&apos;s marks become a percentage, and the
        weights make up the term result. Absent or exempt students are left out of an assessment,
        never given zero.
      </p>
      <PlanForm
        key={`${term.id}-${level.id}`}
        termId={term.id}
        levelId={level.id}
        subjects={plan?.subjects ?? []}
        initial={(plan?.assessments ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          maxMarks: String(a.maxMarks),
          weight: String(a.weight),
          overrides: Object.fromEntries(
            Object.entries(a.overrides).map(([k, v]) => [k, String(v)]),
          ),
          marks: a.marks,
        }))}
      />
    </div>
  );
}
