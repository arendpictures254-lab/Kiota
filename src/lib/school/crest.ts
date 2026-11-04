/**
 * The school's crest (logo), printed first on receipts and statements.
 */
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { type Actor, type Deps, ValidationError, ctxOf } from "@/lib/service-kit";
import { getStorage, schoolKey } from "@/lib/storage";

export const CREST_TYPES = ["image/png", "image/jpeg"];
export const MAX_CREST_BYTES = 2 * 1024 * 1024;

export async function setSchoolCrest(
  { db }: Deps,
  actor: Actor,
  file: { name: string; type: string; bytes: Buffer },
) {
  assertCan(actor.permissions, "school.settings.manage");
  if (file.bytes.length === 0) throw new ValidationError("Choose the crest image.", "file");
  if (file.bytes.length > MAX_CREST_BYTES)
    throw new ValidationError("The image is bigger than 2 MB.", "file");
  if (!CREST_TYPES.includes(file.type))
    throw new ValidationError("Use a PNG or JPG image.", "file");
  const key = schoolKey(actor.schoolId, `crest-${Date.now()}`);
  await getStorage().put(key, file.bytes, file.type);
  await withContext(db, ctxOf(actor), async (tx) => {
    const before = await tx.school.findUniqueOrThrow({ where: { id: actor.schoolId } });
    await tx.school.update({ where: { id: actor.schoolId }, data: { logoUrl: key } });
    await audit(tx, {
      schoolId: actor.schoolId,
      actorId: actor.userId,
      action: "school.crest",
      targetType: "school",
      targetId: actor.schoolId,
      before: { logo: before.logoUrl },
      after: { logo: key },
      ip: actor.ip,
    });
  });
}
