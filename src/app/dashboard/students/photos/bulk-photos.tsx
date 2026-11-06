"use client";

import { useMemo, useRef, useState } from "react";
import { Notice } from "@/components/ui";
import { type PhotoStudent, matchPhotoFiles, photoFileKey } from "@/lib/students/photo-match";
import { shrinkPhoto } from "@/lib/students/shrink-photo";
import { finishBulkPhotosAction, uploadBulkPhotoAction } from "../actions";

type Student = PhotoStudent & { className: string };

/**
 * Bulk photos: choose a folder, several photos or a .zip, each file named by admission number
 * (BA-2025-002.jpg). The preview shows what matched, files that matched nobody, and students
 * still without a photo, before anything is saved. Photos are then sent one at a time (small,
 * over mobile data); the server checks each file name again.
 */
export function BulkPhotos({ students }: { students: Student[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const folder = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const result = useMemo(
    () =>
      files.length
        ? matchPhotoFiles(
            files.map((f) => f.name),
            students,
          )
        : null,
    [files, students],
  );

  async function choose(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setProgress(null);
    const out: File[] = [];
    for (const f of Array.from(list)) {
      if (/\.zip$/i.test(f.name)) {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(f);
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !photoFileKey(entry.name)) continue;
          const blob = await entry.async("blob");
          const name = entry.name.split("/").pop()!;
          const ext = name.split(".").pop()!.toLowerCase();
          out.push(
            new File([blob], name, {
              type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
            }),
          );
        }
      } else out.push(f);
    }
    setFiles(out);
    setReading(false);
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    const failed: string[] = [];
    let done = 0;
    setProgress({ done, failed });
    for (const m of result.matched) {
      const file = files.find((f) => f.name === m.file);
      if (!file) continue;
      const form = new FormData();
      form.set("studentId", m.studentId);
      const small = await shrinkPhoto(file);
      // Keep the admission-number name: the server checks it again.
      form.set("file", new File([small], file.name, { type: small.type }));
      const r = await uploadBulkPhotoAction(form).catch(() => ({ error: "Network error" }));
      if (r.error) failed.push(`${m.file}: ${r.error}`);
      else done++;
      setProgress({ done, failed: [...failed] });
    }
    await finishBulkPhotosAction();
    setSaving(false);
    setFiles([]);
  }

  const button =
    "inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-teal/30 bg-white px-4 font-semibold text-teal hover:bg-egg-blue/30";

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={folder}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose a folder of photos"
        // @ts-expect-error -- non-standard, supported by Chrome, Edge and Firefox
        webkitdirectory=""
        onChange={(e) => void choose(e.target.files)}
      />
      <input
        ref={picker}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.zip,application/zip"
        className="sr-only"
        aria-label="Choose photos or a zip file"
        onChange={(e) => void choose(e.target.files)}
      />
      <div className="flex flex-col gap-2 sm:max-w-xl sm:flex-row">
        <button type="button" className={button} onClick={() => folder.current?.click()}>
          Choose a folder
        </button>
        <button type="button" className={button} onClick={() => picker.current?.click()}>
          Choose photos or a .zip
        </button>
      </div>
      {reading ? <p className="text-ink/70">Reading the files…</p> : null}

      {progress ? (
        <Notice tone={progress.failed.length ? "error" : "success"}>
          {saving ? "Saving… " : ""}
          {progress.done} photo{progress.done === 1 ? "" : "s"} saved
          {progress.failed.length
            ? `, ${progress.failed.length} not saved: ${progress.failed.join("; ")}`
            : "."}
        </Notice>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-4" data-testid="photo-preview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Count label="Match a student" n={result.matched.length} tone="text-status-paid" />
            <Count label="Replace a photo" n={result.matched.filter((m) => m.replaces).length} />
            <Count
              label="Match nobody"
              n={result.unmatched.length + result.duplicates.length}
              tone="text-status-overdue"
            />
            <Count
              label="Students still without a photo"
              n={result.withoutPhoto.length}
              tone="text-status-due"
            />
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || result.matched.length === 0}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-teal px-6 font-semibold text-white disabled:opacity-50 sm:self-start"
          >
            {saving
              ? "Saving…"
              : `Save ${result.matched.length} photo${result.matched.length === 1 ? "" : "s"}`}
          </button>
          <div className="grid gap-4 lg:grid-cols-3">
            <List
              title="Will be saved"
              items={result.matched.map(
                (m) =>
                  `${m.file} → ${m.name} (${m.admissionNumber})${m.replaces ? ", replaces the old photo" : ""}`,
              )}
            />
            <List
              title="Match nobody (check the file name)"
              items={[
                ...result.unmatched,
                ...result.duplicates.map((d) => `${d} (a second photo for the same student)`),
                ...result.notPhotos.map((n) => `${n} (not a photo)`),
              ]}
            />
            <List
              title="Still without a photo"
              items={result.withoutPhoto.map((s) => `${s.name} (${s.admissionNumber})`)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Count({ label, n, tone = "text-ink" }: { label: string; n: number; tone?: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-3">
      <span className="text-xs text-ink/60">{label}</span>
      <span className={`font-heading text-2xl font-bold ${tone}`}>{n}</span>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-4">
      <h3 className="font-heading font-bold">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? <p className="text-sm text-ink/60">None.</p> : null}
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm [overflow-wrap:anywhere] text-ink/80">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  );
}
