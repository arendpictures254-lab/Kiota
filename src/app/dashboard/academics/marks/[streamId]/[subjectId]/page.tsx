import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading, Notice, Select } from "@/components/ui";
import { markSheet } from "@/lib/academics/marks";
import { termChoice } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { submitMarksAction, uploadMarksAction } from "../../../actions";
import { AcademicsShell, loadAcademicsActor, one } from "../../../shared";
import { MarkGrid } from "./mark-grid";

export const metadata: Metadata = { title: "Mark sheet · Kiota" };

type Props = PageProps<"/dashboard/academics/marks/[streamId]/[subjectId]">;

export default function MarkSheetPage({ params, searchParams }: Props) {
  return (
    <AcademicsShell>
      <Suspense fallback={<Loading />}>
        <Sheet params={params} searchParams={searchParams} />
      </Suspense>
    </AcademicsShell>
  );
}

async function Sheet({ params, searchParams }: Props) {
  const { actor } = await loadAcademicsActor();
  const { streamId, subjectId } = await params;
  const { term } = await termChoice(deps, actor, one((await searchParams).term));
  if (!term) notFound();
  const s = await markSheet(deps, actor, { termId: term.id, streamId, subjectId });
  if (!s) notFound();
  const hidden = { termId: term.id, streamId, subjectId };
  const hiddenInputs = Object.entries(hidden).map(([k, v]) => (
    <input key={k} type="hidden" name={k} value={v} />
  ));
  const open = s.assessments.filter((a) => !a.submitted);
  const editable = s.canEdit && s.mine && !s.locked;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold">
          {s.subject.name} · {s.stream.name}
        </h1>
        <p className="text-sm text-ink/70">
          {term.label} · {s.students.length} students · teacher {s.teacher ?? "not assigned"}
        </p>
      </header>

      {s.status === "released" ? (
        <Notice>Released: these marks are final.</Notice>
      ) : s.locked ? (
        <Notice tone={s.canEdit ? "info" : "success"}>
          The class teacher has signed this stream off, so its marks are locked.
          {s.canEdit
            ? " You may still correct a mark: say why, and each change is logged with the old and new mark."
            : " Ask the Principal if a mark is wrong."}
        </Notice>
      ) : !s.mine ? (
        <Notice>
          You are viewing this sheet. Only {s.teacher ?? "the assigned teacher"} enters these marks.
        </Notice>
      ) : null}

      {s.assessments.length === 0 ? (
        <Notice>No assessments for this term yet. The Director of Studies sets them up.</Notice>
      ) : s.students.length === 0 ? (
        <Notice>No students take this subject in this stream.</Notice>
      ) : (
        <MarkGrid
          key={JSON.stringify(s.marks)}
          termId={term.id}
          streamId={streamId}
          subjectId={subjectId}
          scheme={s.scheme}
          assessments={s.assessments}
          students={s.students}
          marks={s.marks}
          canEdit={s.canEdit}
          needsReason={s.locked}
        />
      )}

      {editable && s.assessments.length ? (
        <section aria-labelledby="submit" className="flex flex-col gap-3">
          <h2 id="submit" className="text-section font-bold">
            Done?
          </h2>
          <p className="text-sm text-ink/70">
            Submit each assessment when every student has a mark, A or X. The class teacher sees
            which subjects are complete.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {s.assessments.map((a) =>
              a.submitted ? (
                <p
                  key={a.id}
                  className="rounded-xl bg-status-paid/10 p-3 text-sm font-semibold text-status-paid"
                >
                  {a.name}: submitted
                </p>
              ) : (
                <ActionForm
                  key={a.id}
                  action={submitMarksAction}
                  submitLabel={`Submit ${a.name}`}
                  variant={open.length === 1 ? "primary" : "secondary"}
                  className="flex flex-col"
                >
                  {hiddenInputs}
                  <input type="hidden" name="assessmentId" value={a.id} />
                </ActionForm>
              ),
            )}
          </div>
        </section>
      ) : null}

      {editable && s.assessments.length ? (
        <section
          aria-labelledby="upload"
          className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4"
        >
          <h2 id="upload" className="text-section font-bold">
            Upload from Excel
          </h2>
          <p className="text-sm text-ink/70">
            Download the template for an assessment, fill in the Mark column and upload it. Nothing
            is saved unless every row is right.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {s.assessments.map((a) => (
              <li key={a.id}>
                <Link
                  className="inline-flex min-h-11 items-center font-semibold text-teal underline"
                  href={`/dashboard/academics/marks/${streamId}/${subjectId}/template?term=${term.id}&assessment=${a.id}`}
                  prefetch={false}
                >
                  Template: {a.name}
                </Link>
              </li>
            ))}
          </ul>
          <ActionForm
            action={uploadMarksAction}
            submitLabel="Upload marks"
            variant="secondary"
            className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]"
          >
            {hiddenInputs}
            <Select
              label="Assessment"
              name="assessmentId"
              options={s.assessments.map((a) => ({ value: a.id, label: a.name }))}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor="file" className="text-sm font-semibold">
                Filled template (.xlsx)
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx"
                className="min-h-12 min-w-0 rounded-xl border border-ink/20 bg-white p-2 text-sm"
              />
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
