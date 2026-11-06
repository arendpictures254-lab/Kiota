/**
 * Student photos: every upload (a file, the phone camera, or the bulk upload) is kept as it was,
 * and a portrait is cut from it at one size for ID cards, gate passes and the gate phone.
 */
import sharp from "sharp";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, getStorage, schoolKey } from "@/lib/storage";
import { admissionKey, photoFileKey } from "./photo-match";

/** Portrait size (4:5, like a passport photo): sharp on a CR80 card at 300 dpi. */
export const PORTRAIT = { width: 480, height: 600 } as const;

export type PhotoUpload = { name: string; type: string; bytes: Buffer };

export const canManagePhotos = (p: Actor["permissions"]) =>
  p.has("photos.manage") || p.has("students.edit");

/** Turn any photo into the standard portrait: upright (EXIF), cropped around the face area. */
export async function makePortrait(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize(PORTRAIT.width, PORTRAIT.height, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ValidationError("This file is not a photo Kiota can read. Use a JPG or PNG.", "file");
  }
}

function checkPhoto(file: PhotoUpload) {
  if (file.bytes.length === 0) throw new ValidationError("Choose a photo.", "file");
  if (file.bytes.length > MAX_UPLOAD_BYTES)
    throw new ValidationError("The photo is bigger than 5 MB.", "file");
  if (file.type && !IMAGE_TYPES.includes(file.type))
    throw new ValidationError("Use a JPG, PNG or WebP photo.", "file");
}

/**
 * Save a student's photo: the original, and the cropped portrait used everywhere.
 * `expectAdmission`: for the bulk upload, the file name must still match this student.
 */
export async function saveStudentPhoto(
  { db }: Deps,
  actor: Actor,
  studentId: string,
  file: PhotoUpload,
  opts: { source?: "upload" | "camera" | "bulk"; checkFileName?: boolean } = {},
) {
  if (!canManagePhotos(actor.permissions)) throw new ForbiddenError("photos.manage");
  checkPhoto(file);
  const portrait = await makePortrait(file.bytes);
  return withContext(db, ctxOf(actor), async (tx) => {
    const student = await tx.student.findUnique({
      where: { schoolId: actor.schoolId, id: studentId },
      select: { id: true, admissionNumber: true, photoKey: true },
    });
    if (!student) throw new ValidationError("Student not found.");
    if (opts.checkFileName && photoFileKey(file.name) !== admissionKey(student.admissionNumber))
      throw new ValidationError(
        `${file.name} is not named for ${student.admissionNumber}.`,
        "file",
      );
    const stamp = Date.now();
    const originalKey = schoolKey(actor.schoolId, "students", studentId, `photo-original-${stamp}`);
    const key = schoolKey(actor.schoolId, "students", studentId, `photo-${stamp}`);
    const storage = getStorage();
    await storage.put(originalKey, file.bytes, file.type || "image/jpeg");
    await storage.put(key, portrait, "image/jpeg");
    await tx.student.update({
      where: { schoolId: actor.schoolId, id: studentId },
      data: { photoKey: key, photoOriginalKey: originalKey },
    });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "student.photo",
      targetType: "student",
      targetId: studentId,
      before: { photoKey: student.photoKey },
      after: { photoKey: key, source: opts.source ?? "upload" },
      ip: actor.ip,
    });
    return { key };
  });
}

/** Everyone in the school with whether they have a photo (the bulk upload's preview). */
export async function photoRoster({ db }: Deps, actor: Actor) {
  if (!canManagePhotos(actor.permissions)) throw new ForbiddenError("photos.manage");
  const rows = await withContext(db, ctxOf(actor), (tx) =>
    tx.student.findMany({
      where: { schoolId: actor.schoolId, status: "active" },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        lastName: true,
        photoKey: true,
        class: { select: { name: true } },
        stream: { select: { name: true } },
      },
      orderBy: [{ admissionNumber: "asc" }],
    }),
  );
  return rows.map((s) => ({
    id: s.id,
    admissionNumber: s.admissionNumber,
    name: `${s.firstName} ${s.lastName}`,
    className: `${s.class.name}${s.stream ? ` ${s.stream.name}` : ""}`,
    hasPhoto: !!s.photoKey,
  }));
}
