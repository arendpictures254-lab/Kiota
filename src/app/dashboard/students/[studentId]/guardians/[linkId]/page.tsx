import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Loading } from "@/components/ui";
import { deps } from "@/lib/actions";
import { formatPhone } from "@/lib/phone";
import { getStudent } from "@/lib/students/service";
import { removeGuardianAction, updateGuardianAction } from "../../../actions";
import { GuardianFields } from "../../../fields";
import { StudentsShell, loadStudentsActor } from "../../../shared";

export const metadata: Metadata = { title: "Guardian · Kiota" };

type Props = PageProps<"/dashboard/students/[studentId]/guardians/[linkId]">;

export default function GuardianPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Guardian params={params} />
    </Suspense>
  );
}

async function Guardian({ params }: Pick<Props, "params">) {
  const { studentId, linkId } = await params;
  const { actor } = await loadStudentsActor();
  if (!actor.permissions.has("students.edit")) redirect(`/dashboard/students/${studentId}`);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  const s = await getStudent(deps, actor, studentId);
  const g = s?.guardians.find((x) => x.id === linkId);
  if (!s || !g) notFound();

  return (
    <StudentsShell
      title={g.name}
      back={{ href: `/dashboard/students/${s.id}`, label: "Back to student" }}
    >
      <p className="text-ink/70">
        Phone {formatPhone(g.user.phone)}. To change the number, add the guardian again with the new
        number and remove this one.
      </p>
      <ActionForm action={updateGuardianAction} submitLabel="Save guardian">
        <input type="hidden" name="studentId" value={s.id} />
        <input type="hidden" name="linkId" value={g.id} />
        <GuardianFields
          withPhone={false}
          defaults={{
            name: g.name,
            relationship: g.relationship,
            language: g.language,
            receivesFees: g.receivesFees,
            receivesAcademics: g.receivesAcademics,
            receivesBoarding: g.receivesBoarding,
            authorisedToCollect: g.authorisedToCollect,
          }}
        />
      </ActionForm>
      <ActionForm
        action={removeGuardianAction}
        submitLabel="Remove this guardian"
        variant="danger"
        pendingLabel="Removing…"
      >
        <input type="hidden" name="studentId" value={s.id} />
        <input type="hidden" name="linkId" value={g.id} />
      </ActionForm>
    </StudentsShell>
  );
}
