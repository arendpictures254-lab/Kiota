/**
 * Matching photo files to students by admission number (pure: used in the browser for the
 * preview, and again on the server for each photo saved). A file is named by the admission
 * number with any separators: "BA-2025-002.jpg", "BA_2025_002.JPG" or "ba2025002.png" all match
 * BA/2025/002.
 */

export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/** "BA/2025/002" and "BA-2025-002" both become "BA2025002". */
export const admissionKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The admission-number part of a file name, or null for files that are not photos. */
export function photoFileKey(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  if (!base || base.startsWith(".") || fileName.includes("__MACOSX")) return null;
  const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(base);
  if (!m || !(PHOTO_EXTENSIONS as readonly string[]).includes(m[2].toLowerCase())) return null;
  const key = admissionKey(m[1]);
  return key || null;
}

export type PhotoStudent = {
  id: string;
  admissionNumber: string;
  name: string;
  hasPhoto: boolean;
};

export type PhotoMatch = {
  file: string;
  studentId: string;
  admissionNumber: string;
  name: string;
  /** The student already has a photo: this one replaces it. */
  replaces: boolean;
};

export function matchPhotoFiles(files: readonly string[], students: readonly PhotoStudent[]) {
  const byKey = new Map(students.map((s) => [admissionKey(s.admissionNumber), s]));
  const matched: PhotoMatch[] = [];
  const unmatched: string[] = [];
  const duplicates: string[] = [];
  const notPhotos: string[] = [];
  const taken = new Set<string>();
  for (const file of files) {
    const key = photoFileKey(file);
    if (!key) {
      if (!/(^|[\\/])\.|__MACOSX/.test(file)) notPhotos.push(file);
      continue;
    }
    const s = byKey.get(key);
    if (!s) unmatched.push(file);
    else if (taken.has(s.id)) duplicates.push(file);
    else {
      taken.add(s.id);
      matched.push({
        file,
        studentId: s.id,
        admissionNumber: s.admissionNumber,
        name: s.name,
        replaces: s.hasPhoto,
      });
    }
  }
  const withoutPhoto = students.filter((s) => !s.hasPhoto && !taken.has(s.id));
  return { matched, unmatched, duplicates, notPhotos, withoutPhoto };
}
