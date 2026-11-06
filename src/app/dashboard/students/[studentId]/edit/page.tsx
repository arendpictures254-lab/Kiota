import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { getStructure } from "@/lib/structure/service";
import { getStudent } from "@/lib/students/service";
import { updateStudentAction } from "../../actions";
import { StudentFields } from "../../fields";
import { StudentsShell, isoDay, loadStudentsActor } from "../../shared";

export const metadata: Metadata = { title: "Edit student · Kiota" };

type Props = PageProps<"/dashboard/students/[studentId]/edit">;

export default function EditStudentPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: Pick<Props, "params">) {
  const { studentId } = await params;
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("students.edit")) redirect(`/dashboard/students/${studentId}`);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  const [s, structure] = await Promise.all([
    getStudent(deps, actor, studentId),
    getStructure(deps, actor),
  ]);
  if (!s) notFound();

  return (
    <StudentsShell
      width="form"
      title="Edit student"
      back={{ href: `/dashboard/students/${s.id}`, label: "Back to student" }}
    >
      <ActionForm action={updateStudentAction} submitLabel="Save changes">
        <input type="hidden" name="studentId" value={s.id} />
        <StudentFields
          structure={structure}
          canMedical={actor.permissions.has("students.medical.view")}
          defaults={{
            admissionNumber: s.admissionNumber,
            upi: s.upi,
            firstName: s.firstName,
            middleName: s.middleName,
            lastName: s.lastName,
            gender: s.gender,
            dateOfBirth: isoDay(s.dateOfBirth),
            placement: `${s.classId}|${s.streamId ?? ""}`,
            boarding: s.boarder ? "boarder" : "day",
            houseId: s.houseId,
            specialNeeds: s.specialNeeds,
            medicalNotes: s.medical?.medicalNotes ?? null,
            allergies: s.medical?.allergies ?? null,
          }}
        />
        <p className="text-sm text-ink/60">
          Every change is recorded in the audit log with your name.
        </p>
      </ActionForm>
    </StudentsShell>
  );
}
