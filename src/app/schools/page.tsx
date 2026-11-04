import type { Metadata } from "next";
import { Suspense } from "react";
import { chooseSchoolAction } from "@/app/session-actions";
import { SignOutButton } from "@/components/sign-out-button";
import { ButtonLink, Loading, Notice, Shell } from "@/components/ui";
import { listMySchools, requireUser } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Choose a school · Kiota" };

export default function SchoolsPage() {
  return (
    <Shell title="Choose a school" aside={<SignOutButton />}>
      <Suspense fallback={<Loading />}>
        <SchoolList />
      </Suspense>
    </Shell>
  );
}

async function SchoolList() {
  const user = await requireUser();
  const schools = await listMySchools(user.id);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink/80">Hello {user.name}. Which school do you want to open?</p>
      {schools.length === 0 && !user.isPlatformAdmin ? (
        <Notice>You are not part of any school yet. Ask your school to add you.</Notice>
      ) : null}
      {schools.map((s) => (
        <form key={s.school_id} action={chooseSchoolAction}>
          <input type="hidden" name="schoolId" value={s.school_id} />
          <button
            type="submit"
            className="flex w-full flex-col items-start rounded-2xl border border-ink/10 bg-white p-4 text-left hover:border-teal"
          >
            <span className="font-heading text-lg font-bold text-ink">{s.name}</span>
            <span className="text-sm text-ink/60">{s.role_names.join(", ")}</span>
          </button>
        </form>
      ))}
      {user.isPlatformAdmin ? (
        <ButtonLink href="/admin" variant="secondary">
          Arend Studio admin
        </ButtonLink>
      ) : null}
    </div>
  );
}
