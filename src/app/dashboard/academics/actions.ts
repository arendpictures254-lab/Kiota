"use server";

import { revalidatePath } from "next/cache";
import { saveReportExtras } from "@/lib/academics/comments";
import {
  type MarkEntry,
  type SaveResult,
  saveMarks,
  submitMarks,
  uploadMarks,
} from "@/lib/academics/marks";
import {
  approveResults,
  releaseResults,
  sendBackResults,
  signOffResults,
} from "@/lib/academics/results";
import {
  addBankComment,
  assignTeacher,
  removeBankComment,
  saveAssessmentPlan,
  saveCompetency,
  saveSchemeLevels,
  setLevelGrading,
  updateReportSettings,
} from "@/lib/academics/setup";
import { type FormState, attempt, currentActor, deps, formFile, formObject } from "@/lib/actions";
import { ForbiddenError } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/service-kit";

const done = () => revalidatePath("/dashboard/academics", "layout");
const str = (form: FormData, k: string) => String(form.get(k) ?? "");

/** Autosave from the mark grid (JSON, not a form). */
export async function saveMarksAction(input: {
  termId: string;
  streamId: string;
  subjectId: string;
  entries: MarkEntry[];
  reason?: string;
}): Promise<SaveResult & { error?: string }> {
  try {
    return await saveMarks(deps, await currentActor(), input);
  } catch (err) {
    if (err instanceof ForbiddenError)
      return { saved: 0, errors: [], error: "You don't have permission to change these marks." };
    if (err instanceof ValidationError) return { saved: 0, errors: [], error: err.message };
    throw err;
  }
}

export async function submitMarksAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () =>
      submitMarks(deps, await currentActor(), {
        termId: str(form, "termId"),
        streamId: str(form, "streamId"),
        subjectId: str(form, "subjectId"),
        assessmentId: str(form, "assessmentId"),
      }),
    "Submitted. The class teacher can see it is complete.",
  );
  done();
  return r;
}

export async function uploadMarksAction(_s: FormState, form: FormData): Promise<FormState> {
  let saved = 0;
  const r = await attempt(async () => {
    const file = await formFile(form);
    const out = await uploadMarks(deps, await currentActor(), {
      termId: str(form, "termId"),
      streamId: str(form, "streamId"),
      subjectId: str(form, "subjectId"),
      assessmentId: str(form, "assessmentId"),
      bytes: file.bytes,
    });
    saved = out.saved;
  });
  done();
  return r.error ? r : { ok: `Uploaded: ${saved} mark${saved === 1 ? "" : "s"} saved.` };
}

const flow =
  (fn: typeof signOffResults, ok: string) =>
  async (_s: FormState, form: FormData): Promise<FormState> => {
    const r = await attempt(
      async () => fn(deps, await currentActor(), str(form, "termId"), str(form, "streamId")),
      ok,
    );
    done();
    return r;
  };

export async function signOffAction(s: FormState, form: FormData) {
  return flow(signOffResults, "Signed off. Marks are locked and the Principal can approve.")(
    s,
    form,
  );
}
export async function approveAction(s: FormState, form: FormData) {
  return flow(approveResults, "Approved. Release when the report cards may go out.")(s, form);
}
export async function releaseAction(s: FormState, form: FormData) {
  return flow(async (d, a, t, st) => {
    await releaseResults(d, a, t, st);
  }, "Released. Report cards are ready to print.")(s, form);
}
export async function sendBackAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () =>
      sendBackResults(
        deps,
        await currentActor(),
        str(form, "termId"),
        str(form, "streamId"),
        form.get("reason"),
      ),
    "Sent back to the class teacher. Marks are open again.",
  );
  done();
  return r;
}

export async function reportExtrasAction(_s: FormState, form: FormData): Promise<FormState> {
  const ratings: Record<string, string> = {};
  for (const [k, v] of form.entries())
    if (k.startsWith("rating:") && typeof v === "string") ratings[k.slice(7)] = v;
  const r = await attempt(
    async () =>
      saveReportExtras(deps, await currentActor(), {
        termId: str(form, "termId"),
        streamId: str(form, "streamId"),
        studentId: str(form, "studentId"),
        classTeacherComment: form.has("classTeacherComment")
          ? form.get("classTeacherComment")
          : undefined,
        principalComment: form.has("principalComment") ? form.get("principalComment") : undefined,
        ratings: form.has("ratings") ? ratings : undefined,
      }),
    "Saved.",
  );
  done();
  return r;
}

// ---- Setup ----

export async function assessmentPlanAction(_s: FormState, form: FormData): Promise<FormState> {
  const rows: {
    id: string;
    name: string;
    maxMarks: string;
    weight: string;
    overrides: Record<string, string>;
  }[] = [];
  const count = Number(form.get("rows") ?? 0);
  for (let i = 0; i < count; i++) {
    const overrides: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      const m = /^o-(\d+)-(.+)$/.exec(k);
      if (m && Number(m[1]) === i && typeof v === "string" && v.trim() !== "") overrides[m[2]] = v;
    }
    rows.push({
      id: str(form, `id-${i}`),
      name: str(form, `name-${i}`),
      maxMarks: str(form, `max-${i}`),
      weight: str(form, `weight-${i}`),
      overrides,
    });
  }
  const r = await attempt(
    async () =>
      saveAssessmentPlan(
        deps,
        await currentActor(),
        str(form, "termId"),
        str(form, "levelId"),
        rows,
      ),
    "Saved. Every subject's weights add up to 100%.",
  );
  done();
  return r;
}

export async function assignTeacherAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () =>
      assignTeacher(
        deps,
        await currentActor(),
        str(form, "streamId"),
        str(form, "subjectId"),
        str(form, "membershipId") || null,
      ),
    "Saved.",
  );
  done();
  return r;
}

export async function levelGradingAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => setLevelGrading(deps, await currentActor(), str(form, "levelId"), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function schemeLevelsAction(_s: FormState, form: FormData): Promise<FormState> {
  const rows: Record<string, FormDataEntryValue | null>[] = [];
  const count = Number(form.get("rows") ?? 0);
  for (let i = 0; i < count; i++)
    rows.push({
      code: form.get(`code-${i}`),
      label: form.get(`label-${i}`),
      points: form.get(`points-${i}`),
      minMark: form.get(`min-${i}`),
      maxMark: form.get(`max-${i}`),
      comment: form.get(`comment-${i}`),
    });
  const r = await attempt(
    async () =>
      saveSchemeLevels(
        deps,
        await currentActor(),
        str(form, "schemeId"),
        rows as Parameters<typeof saveSchemeLevels>[3],
      ),
    "Saved.",
  );
  done();
  return r;
}

export async function reportSettingsAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => updateReportSettings(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function competencyAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => saveCompetency(deps, await currentActor(), formObject(form)),
    "Saved.",
  );
  done();
  return r;
}

export async function addBankCommentAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => addBankComment(deps, await currentActor(), formObject(form)),
    "Added to the bank.",
  );
  done();
  return r;
}

export async function removeBankCommentAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => removeBankComment(deps, await currentActor(), str(form, "id")),
    "Removed.",
  );
  done();
  return r;
}
