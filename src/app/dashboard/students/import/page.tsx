import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading } from "@/components/ui";
import { uploadImportAction } from "../actions";
import { StudentsShell, loadStudentsActor } from "../shared";

export const metadata: Metadata = { title: "Import students · Kiota" };

export default function ImportPage() {
  return (
    <StudentsShell width="form" title="Import from Excel">
      <Suspense fallback={<Loading />}>
        <Import />
      </Suspense>
    </StudentsShell>
  );
}

async function Import() {
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("import.run")) redirect("/dashboard/students");
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-section font-bold">1. Download the template</h2>
        <p className="text-ink/70">
          It has a sheet each for Students, Guardians and Classes, and a README sheet that explains
          every column. The class lists match your school.
        </p>
        <a
          href="/dashboard/students/import/template"
          download
          className="inline-flex h-12 items-center justify-center rounded-xl border border-teal/30 bg-white px-5 font-semibold text-teal hover:bg-egg-blue/30"
        >
          Download template (.xlsx)
        </a>
      </Card>

      <Card>
        <ActionForm
          action={uploadImportAction}
          submitLabel="Check the file"
          pendingLabel="Checking…"
        >
          <h2 className="font-heading text-section font-bold">2. Upload the filled-in file</h2>
          <p className="text-ink/70">
            Kiota checks every row and shows you any problems. Nothing is saved until you confirm.
          </p>
          <Field
            label="Excel file"
            name="file"
            id="import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
          />
        </ActionForm>
      </Card>
    </div>
  );
}
