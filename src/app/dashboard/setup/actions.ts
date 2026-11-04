"use server";

import { revalidatePath } from "next/cache";
import { type FormState, attempt, currentActor, deps, formObject } from "@/lib/actions";
import { promoteClass } from "@/lib/students/promotion";
import * as structure from "@/lib/structure/service";

function done() {
  revalidatePath("/dashboard/setup", "layout");
  revalidatePath("/dashboard/students", "layout");
}

export async function setLevelEnabledAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const enabled = f.enabled === "1";
  const r = await attempt(
    async () => structure.setLevelEnabled(deps, await currentActor(), f.levelId, enabled),
    enabled ? "Switched on." : "Switched off.",
  );
  done();
  return r;
}

export async function addStreamAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () => structure.addStream(deps, await currentActor(), f.classId, f.name),
    "Stream added.",
  );
  done();
  return r;
}

export async function removeStreamAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removeStream(deps, await currentActor(), formObject(form).streamId),
  );
  done();
  return r;
}

export async function setClassTeacherAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      structure.setClassTeacher(deps, await currentActor(), f.streamId, f.membershipId || null),
    "Class teacher saved.",
  );
  done();
  return r;
}

export async function addHouseAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(
    async () => structure.addHouse(deps, await currentActor(), formObject(form).name),
    "House added.",
  );
  done();
  return r;
}

export async function removeHouseAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removeHouse(deps, await currentActor(), formObject(form).houseId),
  );
  done();
  return r;
}

export async function addDormitoryAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () => structure.addDormitory(deps, await currentActor(), f.name, f.bedCapacity),
    "Dormitory added.",
  );
  done();
  return r;
}

export async function removeDormitoryAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removeDormitory(deps, await currentActor(), formObject(form).dormitoryId),
  );
  done();
  return r;
}

export async function addYearAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      structure.addAcademicYear(deps, await currentActor(), {
        name: f.name,
        startDate: f.startDate,
        endDate: f.endDate,
      }),
    "Academic year added.",
  );
  done();
  return r;
}

export async function addTermAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      structure.addTerm(deps, await currentActor(), {
        academicYearId: f.academicYearId,
        name: f.name,
        startDate: f.startDate,
        halfTermStart: f.halfTermStart,
        halfTermEnd: f.halfTermEnd,
        endDate: f.endDate,
      }),
    "Term added.",
  );
  done();
  return r;
}

export async function removeTermAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removeTerm(deps, await currentActor(), formObject(form).termId),
  );
  done();
  return r;
}

export async function addSubjectAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      structure.addSubject(deps, await currentActor(), {
        levelId: f.levelId,
        name: f.name,
        code: f.code,
      }),
    "Subject added.",
  );
  done();
  return r;
}

export async function removeSubjectAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removeSubject(deps, await currentActor(), formObject(form).subjectId),
  );
  done();
  return r;
}

export async function addPathwayAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  const r = await attempt(
    async () =>
      structure.addPathway(deps, await currentActor(), { levelId: f.levelId, name: f.name }),
    "Pathway added.",
  );
  done();
  return r;
}

export async function removePathwayAction(_s: FormState, form: FormData): Promise<FormState> {
  const r = await attempt(async () =>
    structure.removePathway(deps, await currentActor(), formObject(form).pathwayId),
  );
  done();
  return r;
}

export async function promoteAction(_s: FormState, form: FormData): Promise<FormState> {
  const f = formObject(form);
  let message = "";
  const r = await attempt(async () => {
    const plan = await promoteClass(deps, await currentActor(), f.classId);
    message = plan.toClass
      ? `${plan.total} students moved from ${plan.fromClass.name} to ${plan.toClass.name}.`
      : `${plan.total} students in ${plan.fromClass.name} marked as graduated.`;
  });
  done();
  return r.error ? r : { ok: message };
}
