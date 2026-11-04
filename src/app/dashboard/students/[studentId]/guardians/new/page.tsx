import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { fullName } from "@/lib/students/rules";
import { getStudent } from "@/lib/students/service";
import { addGuardianAction } from "../../../actions";
import { GuardianFields } from "../../../fields";
import { StudentsShell, loadStudentsActor } from "../../../shared";

export const metadata: Metadata = { title: "Add a guardian · Kiota" };

type Props = PageProps<"/dashboard/students/[studentId]/guardians/new">;

export default function NewGuardianPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <NewGuardian params={params} />
    </Suspense>
  );
}

async function NewGuardian({ params }: Pick<Props, "params">) {
  const { studentId } = await params;
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("students.edit")) redirect(`/dashboard/students/${studentId}`);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  const s = await getStudent(deps, actor, studentId);
  if (!s) notFound();
  return (
    <StudentsShell
      title={`Add a guardian for ${fullName(s)}`}
      back={{ href: `/dashboard/students/${s.id}`, label: "Back to student" }}
    >
      <ActionForm action={addGuardianAction} submitLabel="Add guardian">
        <input type="hidden" name="studentId" value={s.id} />
        <GuardianFields />
      </ActionForm>
    </StudentsShell>
  );
}
