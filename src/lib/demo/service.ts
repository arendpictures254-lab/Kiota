/**
 * "Book a demo" requests from the public site. Platform level: no school data and never any
 * child details. Stored through app_submit_demo_request() (rate-limited in the database) and
 * readable only by Arend admins (row-level security).
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/permissions";
import { withContext } from "@/lib/db-core";
import { normalizePhone } from "@/lib/phone";
import { ValidationError, clean } from "@/lib/service-kit";

export const SCHOOL_TYPES = [
  { value: "day", label: "Day school" },
  { value: "boarding", label: "Boarding school" },
  { value: "mixed", label: "Day and boarding" },
] as const;

export const DEMO_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "demo_booked", label: "Demo booked" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const;

export type DemoStatus = (typeof DEMO_STATUSES)[number]["value"];

export type DemoInput = {
  schoolName: string;
  county: string;
  contactName: string;
  contactRole: string;
  phone: string;
  email: string | null;
  studentCount: number;
  schoolType: string;
  message: string | null;
};

/** Pure validation, unit tested. Throws ValidationError with the field name. */
export function parseDemoRequest(raw: Record<string, unknown>): DemoInput {
  const text = (key: string, label: string, max = 120) => {
    const v = clean(raw[key]);
    if (!v) throw new ValidationError(`Enter the ${label}.`, key);
    if (v.length > max) throw new ValidationError(`The ${label} is too long.`, key);
    return v;
  };
  const schoolName = text("schoolName", "school name");
  const county = text("county", "county", 60);
  const contactName = text("contactName", "contact person's name");
  const contactRole = text("contactRole", "contact person's role", 60);
  const phone = normalizePhone(String(raw.phone ?? ""));
  if (!phone)
    throw new ValidationError("Enter a phone number we can call, like 0712 345 678.", "phone");
  const email = clean(raw.email);
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120)) {
    throw new ValidationError("Enter a valid email address, or leave it blank.", "email");
  }
  const studentCount = Number(clean(raw.studentCount)?.replace(/,/g, ""));
  if (!Number.isInteger(studentCount) || studentCount < 1 || studentCount > 20_000) {
    throw new ValidationError("Enter roughly how many students the school has.", "studentCount");
  }
  const schoolType = clean(raw.schoolType);
  if (!SCHOOL_TYPES.some((t) => t.value === schoolType)) {
    throw new ValidationError("Choose day, boarding or mixed.", "schoolType");
  }
  const message = clean(raw.message);
  if (message && message.length > 2000) {
    throw new ValidationError("The message is too long (2,000 characters at most).", "message");
  }
  return {
    schoolName,
    county,
    contactName,
    contactRole,
    phone,
    email,
    studentCount,
    schoolType: schoolType!,
    message,
  };
}

/** True when the hidden honeypot field was filled in (a bot). */
export function isBot(raw: Record<string, unknown>) {
  return (clean(raw.website) ?? "") !== "";
}

export function hashIp(ip: string | null, secret: string) {
  return createHash("sha256")
    .update(`${secret}:${ip ?? "unknown"}`)
    .digest("hex");
}

export class RateLimitedError extends Error {}

export async function submitDemoRequest(db: PrismaClient, input: DemoInput, ipHash: string) {
  try {
    const [{ id }] = await db.$queryRaw<{ id: string }[]>`
      SELECT app_submit_demo_request(
        ${input.schoolName}, ${input.county}, ${input.contactName}, ${input.contactRole},
        ${input.phone}, ${input.email}, ${input.studentCount}::int, ${input.schoolType},
        ${input.message}, ${ipHash}) AS id`;
    return id;
  } catch (err) {
    if (String(err).includes("rate_limited")) throw new RateLimitedError();
    throw err;
  }
}

export async function listDemoRequests(
  db: PrismaClient,
  admin: { userId: string; isPlatformAdmin: boolean },
) {
  if (!admin.isPlatformAdmin) throw new ForbiddenError("platform.admin");
  return withContext(db, { userId: admin.userId, schoolId: null }, (tx) =>
    tx.demoRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  );
}

export async function setDemoStatus(
  db: PrismaClient,
  admin: { userId: string; isPlatformAdmin: boolean },
  id: string,
  status: string,
) {
  if (!admin.isPlatformAdmin) throw new ForbiddenError("platform.admin");
  if (!DEMO_STATUSES.some((s) => s.value === status)) throw new ValidationError("Choose a status.");
  await withContext(db, { userId: admin.userId, schoolId: null }, async (tx) => {
    const updated = await tx.demoRequest.updateMany({
      where: { id },
      data: { status: status as DemoStatus },
    });
    if (updated.count === 0) throw new ValidationError("Request not found.");
  });
}
