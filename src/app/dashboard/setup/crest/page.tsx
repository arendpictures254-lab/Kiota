import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Loading } from "@/components/ui";
import { type FormState, attempt, currentActor, deps, formFile } from "@/lib/actions";
import { requireSchool } from "@/lib/auth/context";
import { schoolCrest } from "@/lib/fees/receipts";
import { setSchoolCrest } from "@/lib/school/crest";
import { db } from "@/lib/db";
import { SetupShell } from "../shared";

export const metadata: Metadata = { title: "School crest · Kiota" };

async function uploadCrestAction(_s: FormState, form: FormData): Promise<FormState> {
  "use server";
  const file = await formFile(form);
  const r = await attempt(
    async () => setSchoolCrest(deps, await currentActor(), file),
    "Crest saved.",
  );
  revalidatePath("/dashboard/setup/crest");
  return r;
}

export default function CrestPage() {
  return (
    <SetupShell title="School crest">
      <Suspense fallback={<Loading />}>
        <Crest />
      </Suspense>
    </SetupShell>
  );
}

async function Crest() {
  const ctx = await requireSchool();
  if (!ctx.permissions.has("school.settings.manage")) redirect("/dashboard/setup");
  const school = await db(ctx.dbContext).school.findUniqueOrThrow({ where: { id: ctx.school.id } });
  const crest = await schoolCrest(school.logoUrl, school.id);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink/70">
        Your crest is printed first on receipts and fee statements, above your school&apos;s name.
        Kiota appears small at the bottom.
      </p>
      {crest ? (
        <Card className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- private stored image */}
          <img
            src={`data:${crest.contentType};base64,${crest.bytes.toString("base64")}`}
            alt="Current crest"
            className="size-32 object-contain"
          />
        </Card>
      ) : null}
      <ActionForm action={uploadCrestAction} submitLabel={crest ? "Replace crest" : "Upload crest"}>
        <Field
          label="Crest image (PNG or JPG, up to 2 MB)"
          name="file"
          type="file"
          accept="image/png,image/jpeg"
          required
        />
      </ActionForm>
    </div>
  );
}
