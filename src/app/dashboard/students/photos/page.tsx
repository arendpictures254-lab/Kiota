import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Notice } from "@/components/ui";
import { deps } from "@/lib/actions";
import { canManagePhotos, photoRoster } from "@/lib/students/photos";
import { StudentsShell, loadStudentsActor } from "../shared";
import { BulkPhotos } from "./bulk-photos";

export const metadata: Metadata = { title: "Student photos · Kiota" };

export default function PhotosPage() {
  return (
    <StudentsShell title="Student photos" back={{ href: "/dashboard/students", label: "Students" }}>
      <Suspense fallback={<Loading />}>
        <Photos />
      </Suspense>
    </StudentsShell>
  );
}

async function Photos() {
  const { actor } = await loadStudentsActor();
  if (!canManagePhotos(actor.permissions))
    return <Notice tone="error">You can&apos;t change student photos.</Notice>;
  const roster = await photoRoster(deps, actor);
  const without = roster.filter((s) => !s.hasPhoto).length;
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[72ch] text-ink/70">
        Name each photo by the student&apos;s admission number, for example{" "}
        <strong>BA-2025-002.jpg</strong> for BA/2025/002. Upload a folder, several photos or one
        .zip file. You see what matches before anything is saved. Kiota keeps every original and
        crops a portrait for ID cards and gate passes.
      </p>
      <p className="text-sm font-semibold text-ink">
        {roster.length - without} of {roster.length} students have a photo.
      </p>
      <BulkPhotos students={roster} />
    </div>
  );
}
