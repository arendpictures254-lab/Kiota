"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { Notice } from "@/components/ui";
import type { FormState } from "@/lib/actions";
import { shrinkPhoto } from "@/lib/students/shrink-photo";
import { uploadPhotoAction } from "../actions";

/**
 * A student's photo: take it with the phone camera, or choose a file. Kiota keeps the original
 * and crops a standard portrait for ID cards, passes and the gate.
 */
export function PhotoCapture({ studentId }: { studentId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadPhotoAction, {});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<"camera" | "upload">("upload");
  /** The file last sent: once saved, its preview goes away. */
  const [sent, setSent] = useState<File | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Free the last preview's memory when a new one replaces it (or on leaving the page).
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = (f: File | undefined, from: "camera" | "upload") => {
    if (!f) return;
    setSource(from);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!file) return;
    const form = new FormData();
    form.set("studentId", studentId);
    form.set("source", source);
    form.set("file", await shrinkPhoto(file));
    setSent(file);
    startTransition(() => action(form));
  };

  const button =
    "inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-teal/30 bg-white px-4 font-semibold text-teal hover:bg-egg-blue/30";

  return (
    <div className="flex flex-col gap-3" data-testid="photo-capture">
      <h2 className="font-heading text-section font-bold">Photo</h2>
      <p className="text-sm text-ink/60">
        Face the camera, plain background. Kiota crops it to the ID card size.
      </p>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Take a photo"
        onChange={(e) => pick(e.target.files?.[0], "camera")}
      />
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose a photo file"
        onChange={(e) => pick(e.target.files?.[0], "upload")}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={button} onClick={() => camera.current?.click()}>
          Take a photo
        </button>
        <button type="button" className={button} onClick={() => picker.current?.click()}>
          Choose a file
        </button>
      </div>
      {file && preview && !(state.ok && sent === file) ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
          <img
            src={preview}
            alt="New photo"
            className="aspect-[4/5] w-24 rounded-xl object-cover"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-teal px-5 font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save photo"}
          </button>
        </div>
      ) : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </div>
  );
}
