import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { getStructure } from "@/lib/structure/service";
import { createStudentAction } from "../actions";
import { GuardianFields, StudentFields } from "../fields";
import { StudentsShell, loadStudentsActor } from "../shared";

export const metadata: Metadata = { title: "Add a student · Kiota" };

export default function NewStudentPage() {
  return (
    <StudentsShell width="form" title="Add a student">
      <Suspense fallback={<Loading />}>
        <NewStudent />
      </Suspense>
    </StudentsShell>
  );
}

async function NewStudent() {
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("students.edit")) redirect("/dashboard/students");
  const structure = await getStructure(deps, actor);
  return (
    <ActionForm action={createStudentAction} submitLabel="Add student" pendingLabel="Adding…">
      <StudentFields
        structure={structure}
        canMedical={actor.permissions.has("students.medical.view")}
      />
      <h2 className="mt-2 font-heading text-lg font-bold">Guardian</h2>
      <GuardianFields prefix="g1_" />
      <details className="rounded-2xl border border-ink/10 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-teal">Add a second guardian</summary>
        <div className="mt-4 flex flex-col gap-4">
          <GuardianFields prefix="g2_" required={false} defaults={{ relationship: "father" }} />
        </div>
      </details>
      <details className="rounded-2xl border border-ink/10 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-teal">Add a third guardian</summary>
        <div className="mt-4 flex flex-col gap-4">
          <GuardianFields
            prefix="g3_"
            required={false}
            defaults={{
              relationship: "sponsor",
              receivesAcademics: false,
              receivesBoarding: false,
              authorisedToCollect: false,
            }}
          />
        </div>
      </details>
    </ActionForm>
  );
}
