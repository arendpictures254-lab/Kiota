import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { teachingOverview } from "@/lib/academics/setup";
import { deps } from "@/lib/actions";
import { AcademicsShell, loadAcademicsActor } from "../../shared";
import { TeacherSelect } from "./teacher-select";

export const metadata: Metadata = { title: "Teaching assignments · Kiota" };

export default function TeachingPage() {
  return (
    <AcademicsShell title="Teaching assignments">
      <Suspense fallback={<Loading />}>
        <Teaching />
      </Suspense>
    </AcademicsShell>
  );
}

async function Teaching() {
  const { actor } = await loadAcademicsActor();
  if (!actor.permissions.has("academics.setup"))
    return (
      <Notice tone="error">
        Teaching assignments are set by the Director of Studies or the Principal.
      </Notice>
    );
  const t = await teachingOverview(deps, actor);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink/70">
        Who teaches each subject in each stream. Only that teacher enters its marks. Teachers are
        staff with a teaching role (subject teacher, class teacher, Director of Studies).
      </p>
      {!t.teachers.length ? <Notice>No teaching staff yet. Invite them under Staff.</Notice> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {t.streams.map((s) => (
          <section
            key={s.id}
            aria-labelledby={`s-${s.id}`}
            className="flex min-w-0 flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4"
          >
            <h2 id={`s-${s.id}`} className="text-section font-bold">
              {s.name}
            </h2>
            {s.subjects.map((sub) => (
              <TeacherSelect
                key={sub.id}
                streamId={s.id}
                subjectId={sub.id}
                subject={sub.name}
                stream={s.name}
                value={sub.membershipId}
                teachers={t.teachers}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
