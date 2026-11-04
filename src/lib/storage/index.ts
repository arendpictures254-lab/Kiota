/**
 * File storage behind one interface. Drivers: "local" (disk, development) for now;
 * an S3-compatible driver comes before launch (see docs/launch-checklist.md).
 *
 * Keys always start with the school id: schools/<schoolId>/... so one school's files can never
 * be addressed through another school's records.
 */
import { localDriver } from "./local-driver";

export type StoredFile = { bytes: Buffer; contentType: string };

export type StorageDriver = {
  name: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
};

const drivers: Record<string, StorageDriver> = { local: localDriver };

export function getStorage(): StorageDriver {
  const name = process.env.STORAGE_DRIVER ?? "local";
  const driver = drivers[name];
  if (!driver) throw new Error(`Unknown STORAGE_DRIVER "${name}"`);
  return driver;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Build a storage key from safe segments, e.g. schoolKey(id, "students", sid, "photo"). */
export function schoolKey(schoolId: string, ...parts: string[]): string {
  const segments = ["schools", schoolId, ...parts];
  for (const s of segments) {
    if (!SAFE_SEGMENT.test(s) || s === "." || s === "..") {
      throw new Error(`Unsafe storage key segment: ${s}`);
    }
  }
  return segments.join("/");
}

export function assertKeyBelongsTo(key: string, schoolId: string): void {
  if (!key.startsWith(`schools/${schoolId}/`)) throw new Error("File does not belong to school");
}

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
