"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormState, attempt, currentActor, deps, formFile, formObject } from "@/lib/actions";
import { confirmImport, previewImport } from "@/lib/import/run";
import { ValidationError } from "@/lib/service-kit";
import * as students from "@/lib/students/service";
import { withPlacement } from "./fields";

const MAX_NEW_GUARDIANS = 3;

/** Guardians on the add-student form use prefixes g1_, g2_, g3_. Blank blocks are skipped. */
function guardiansFrom(f: Record<string, string>) {
  const list = [];
  for (let i = 1; i <= MAX_NEW_GUARDIANS; i++) {
    const p = `g${i}_`;
    const filled = ["name", "phone"].some((k) => (f[`${p}${k}`] ?? "").trim() !== "");
    if (!filled) continue;
    list.push(students.parseGuardianInput(f, p));
  }
  if (list.length === 0) {
    throw new ValidationError("Add at least one guardian with a phone number.", "g1_name");
  }
  return list;
}

export async function createStudentAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let id = "";
  const r = await attempt(async () => {
    const actor = await currentActor();
    const input = students.parseStudentInput(withPlacement(f));
    id = (await students.createStudent(deps, actor, input, guardiansFrom(f))).studentId;
  });
  if (r.error) return r;
  revalidatePath("/dashboard/students");
  redirect(`/dashboard/students/${id}?added=1`);
}

export async function updateStudentAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () =>
    students.updateStudent(
      deps,
      await currentActor(),
      f.studentId,
      students.parseStudentInput(withPlacement(f)),
    ),
  );
  if (r.error) return r;
  revalidatePath(`/dashboard/students/${f.studentId}`);
  redirect(`/dashboard/students/${f.studentId}?saved=1`);
}

export async function changeStatusAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      students.changeStudentStatus(deps, await currentActor(), f.studentId, {
        status: f.status,
        date: f.date,
        reason: f.reason,
      }),
    "Status changed.",
  );
  revalidatePath(`/dashboard/students/${f.studentId}`);
  return r;
}

export async function setSubjectsAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      students.setStudentSubjects(
        deps,
        await currentActor(),
        f.studentId,
        f.pathwayId || null,
        form.getAll("subjects").map(String),
      ),
    "Subjects saved.",
  );
  revalidatePath(`/dashboard/students/${f.studentId}`);
  return r;
}

export async function addGuardianAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () =>
    students.addGuardian(deps, await currentActor(), f.studentId, students.parseGuardianInput(f)),
  );
  if (r.error) return r;
  revalidatePath(`/dashboard/students/${f.studentId}`);
  redirect(`/dashboard/students/${f.studentId}`);
}

export async function updateGuardianAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () => {
    // Phone is fixed for a link (it is the parent's identity); parse with a placeholder.
    const g = students.parseGuardianInput({ ...f, phone: "0700000000" });
    const { phone: _phone, ...rest } = g;
    void _phone;
    await students.updateGuardian(deps, await currentActor(), f.linkId, rest);
  });
  if (r.error) return r;
  revalidatePath(`/dashboard/students/${f.studentId}`);
  redirect(`/dashboard/students/${f.studentId}`);
}

export async function removeGuardianAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(async () =>
    students.removeGuardian(deps, await currentActor(), f.linkId),
  );
  if (r.error) return r;
  revalidatePath(`/dashboard/students/${f.studentId}`);
  redirect(`/dashboard/students/${f.studentId}`);
}

export async function uploadPhotoAction(_s: FormState, form: FormData): Promise<FormState> {
  const studentId = String(form.get("studentId") ?? "");
  const file = await formFile(form);
  const r = await attempt(
    async () => students.setStudentPhoto(deps, await currentActor(), studentId, file),
    "Photo saved.",
  );
  revalidatePath(`/dashboard/students/${studentId}`);
  return r;
}

export async function uploadDocumentAction(_s: FormState, form: FormData): Promise<FormState> {
  const studentId = String(form.get("studentId") ?? "");
  const file = await formFile(form);
  const r = await attempt(
    async () =>
      students.addStudentDocument(deps, await currentActor(), studentId, form.get("kind"), file),
    "Document saved.",
  );
  revalidatePath(`/dashboard/students/${studentId}`);
  return r;
}

// ---- Import ----

export async function uploadImportAction(_s: FormState, form: FormData): Promise<FormState> {
  const file = await formFile(form);
  let batchId = "";
  const r = await attempt(async () => {
    batchId = (await previewImport(deps, await currentActor(), file)).batchId;
  });
  if (r.error) return r;
  redirect(`/dashboard/students/import/${batchId}`);
}

export async function confirmImportAction(_s: FormState, form: FormData): Promise<FormState> {
  const batchId = String(form.get("batchId") ?? "");
  const r = await attempt(async () => confirmImport(deps, await currentActor(), batchId));
  if (r.error) return r;
  revalidatePath("/dashboard/students");
  redirect(`/dashboard/students/import/${batchId}`);
}
