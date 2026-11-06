import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Card, Field, Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { type ImportSummary, getImportPreview } from "@/lib/import/run";
import type { Issue } from "@/lib/import/validate";
import { confirmImportAction, uploadImportAction } from "../../actions";
import { StudentsShell, loadStudentsActor } from "../../shared";

export const metadata: Metadata = { title: "Check import · Kiota" };

type Props = PageProps<"/dashboard/students/import/[batchId]">;

export default function ImportBatchPage({ params }: Props) {
  return (
    <StudentsShell back={{ href: "/dashboard/students/import", label: "Import" }}>
      <Suspense fallback={<Loading />}>
        <Batch params={params} />
      </Suspense>
    </StudentsShell>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-xl bg-cream p-3">
      <p className="font-heading text-2xl font-bold text-teal">{n}</p>
      <p className="text-sm text-ink/70">{label}</p>
    </div>
  );
}

function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warning" }) {
  return (
    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3 [&>li]:min-w-0 [&>li>*]:h-full">
      {issues.map((i, k) => (
        <li
          key={k}
          className={`rounded-xl border p-3 text-sm ${tone === "error" ? "border-status-overdue/30 bg-status-overdue/5" : "border-status-due/30 bg-status-due/5"}`}
        >
          <p className="font-semibold text-ink">
            {i.sheet}
            {i.row ? `, row ${i.row}` : ""}
            {i.column ? `, ${i.column}` : ""}
          </p>
          <p className="text-ink">{i.message}</p>
          <p className="text-ink/70">Fix: {i.fix}</p>
        </li>
      ))}
    </ul>
  );
}

async function Batch({ params }: Pick<Props, "params">) {
  const { batchId } = await params;
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("import.run")) redirect("/dashboard/students");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
  const result = await getImportPreview(deps, actor, batchId);
  if (!result) notFound();
  const { batch, plan } = result;

  if (!plan) {
    const s = batch.summary as unknown as ImportSummary;
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-heading text-title font-bold">Import complete</h1>
        <Notice tone="success">
          {batch.fileName} was imported. {s.studentsNew} new students, {s.studentsUpdated} updated,{" "}
          {s.guardianRows} guardian links.
        </Notice>
        <div className="grid grid-cols-2 gap-3">
          <Count n={s.studentsNew} label="New students" />
          <Count n={s.studentsUpdated} label="Students updated" />
          <Count n={s.guardianRows} label="Guardian links" />
          <Count n={s.openingBalances} label="Opening balances" />
        </div>
        <ButtonLink href="/dashboard/students">See students</ButtonLink>
      </div>
    );
  }

  const errors = plan.issues.filter((i) => i.severity === "error");
  const warnings = plan.issues.filter((i) => i.severity === "warning");
  const c = plan.counts;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-title font-bold">Check before importing</h1>
        <p className="text-ink/70">{batch.fileName}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Count n={c.studentsNew} label="New students" />
        <Count n={c.studentsUpdated} label="Students to update" />
        <Count n={c.guardianRows} label="Guardian links" />
        <Count n={c.openingBalances} label="Opening balances" />
        {c.streamsNew ? <Count n={c.streamsNew} label="New streams" /> : null}
        {c.housesNew ? <Count n={c.housesNew} label="New houses" /> : null}
      </div>

      {errors.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-section font-bold text-status-overdue">
            {errors.length} problem{errors.length === 1 ? "" : "s"} to fix
          </h2>
          <p className="text-ink/70">
            Fix these in the Excel file, save it, and upload it again below.
          </p>
          <IssueList issues={errors} tone="error" />
        </section>
      ) : (
        <Notice tone="success">No problems found. Nothing is saved until you press Import.</Notice>
      )}

      {warnings.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-section font-bold text-status-due">
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} to check
          </h2>
          <p className="text-ink/70">These will not stop the import.</p>
          <IssueList issues={warnings} tone="warning" />
        </section>
      ) : null}

      {errors.length === 0 ? (
        <ActionForm
          action={confirmImportAction}
          submitLabel={`Import ${c.studentsNew + c.studentsUpdated} students`}
          pendingLabel="Importing…"
        >
          <input type="hidden" name="batchId" value={batch.id} />
        </ActionForm>
      ) : null}

      <Card>
        <ActionForm
          action={uploadImportAction}
          submitLabel="Check the corrected file"
          pendingLabel="Checking…"
          variant={errors.length ? "primary" : "secondary"}
        >
          <h2 className="font-heading text-section font-bold">Upload a corrected file</h2>
          <Field
            label="Excel file"
            name="file"
            id="reupload-file"
            type="file"
            accept=".xlsx"
            required
          />
        </ActionForm>
      </Card>
    </div>
  );
}
