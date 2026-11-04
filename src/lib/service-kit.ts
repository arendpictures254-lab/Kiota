/**
 * Shared pieces for service modules (src/lib/<area>/service.ts). Every service function takes
 * an Actor, checks permissions itself, runs inside the school's row-level-security context and
 * writes the audit log in the same transaction.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { PermissionKey } from "@/lib/auth/catalog";

export type Actor = {
  userId: string;
  schoolId: string;
  permissions: ReadonlySet<PermissionKey>;
  ip?: string | null;
};

export type Deps = { db: PrismaClient };

/** A problem the person can fix (shown next to the field when `field` is set). */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function ctxOf(actor: Actor) {
  return { userId: actor.userId, schoolId: actor.schoolId };
}

/** Trim; empty becomes null. */
export function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** Parse YYYY-MM-DD (or DD/MM/YYYY) into a UTC date, or null. */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const s = clean(value);
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    // Kenyan order: day first.
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

export function isoDate(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
