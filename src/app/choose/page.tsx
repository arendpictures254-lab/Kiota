import type { Metadata } from "next";
import { Suspense } from "react";
import { chooseModeAction } from "@/app/session-actions";
import { SignOutButton } from "@/components/sign-out-button";
import { Loading, Shell } from "@/components/ui";
import { hasChildren, listMySchools, requireUser } from "@/lib/auth/context";
import { getT } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Kiota" };

/** For people who are both staff and a parent (a teacher whose child attends). */
export default function ChoosePage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Loading />
        </Shell>
      }
    >
      <Choose />
    </Suspense>
  );
}

async function Choose() {
  const user = await requireUser();
  const [{ t }, schools, kids] = await Promise.all([
    getT(),
    listMySchools(user.id),
    hasChildren(user.id),
  ]);
  const staff = schools.length > 0 || user.isPlatformAdmin;
  if (!staff && kids) redirect("/parent");
  if (staff && !kids) redirect(schools.length ? "/schools" : "/admin");

  const option = (mode: "staff" | "parent", title: string, hint: string) => (
    <form action={chooseModeAction}>
      <input type="hidden" name="mode" value={mode} />
      <button
        type="submit"
        className="flex min-h-20 w-full flex-col items-start justify-center rounded-2xl border border-ink/10 bg-white p-5 text-left hover:border-teal"
      >
        <span className="font-heading text-xl font-bold text-ink">{title}</span>
        <span className="text-ink/60">{hint}</span>
      </button>
    </form>
  );

  return (
    <Shell title={t("choose.title")} aside={<SignOutButton />}>
      <div className="flex flex-col gap-3">
        {option("parent", t("choose.parent"), t("choose.parentHint"))}
        {option("staff", t("choose.staff"), t("choose.staffHint"))}
      </div>
    </Shell>
  );
}
