import "server-only";

import { clientIp, requireSchool, type SchoolContext } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permissions";
import { platformDb } from "@/lib/db";
import { type Actor, ValidationError } from "@/lib/service-kit";

/** What every form action returns: a message to show, and which field it is about. */
export type FormState = { error?: string; field?: string; ok?: string };

export const deps = { db: platformDb };

export async function actorFor(ctx: SchoolContext): Promise<Actor> {
  return {
    userId: ctx.user.id,
    schoolId: ctx.school.id,
    permissions: ctx.permissions,
    ip: await clientIp(),
  };
}

/** The current school's actor (redirects to sign-in / school picker when needed). */
export async function currentActor(): Promise<Actor> {
  return actorFor(await requireSchool());
}

/** Run a service call and turn expected errors into a FormState. */
export async function attempt(fn: () => Promise<unknown>, ok?: string): Promise<FormState> {
  try {
    await fn();
    return ok ? { ok } : {};
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
    if (err instanceof ValidationError) return { error: err.message, field: err.field };
    throw err;
  }
}

/** Form data as a plain object (single values). */
export function formObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Read an uploaded file from a form. */
export async function formFile(form: FormData, name = "file") {
  const f = form.get(name);
  if (!(f instanceof File)) return { name: "", type: "", bytes: Buffer.alloc(0) };
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}
