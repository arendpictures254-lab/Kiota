import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { platformDb } from "@/lib/db";

/**
 * Sessions: the cookie holds a random token (httpOnly, Secure in production, SameSite=Lax).
 * The database stores only its SHA-256 hash, the user, and the school they chose.
 */
export const SESSION_COOKIE = "kiota_session";
const SESSION_DAYS = 30;

export type SessionRecord = {
  id: string;
  userId: string;
  schoolId: string | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ id: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await platformDb.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { id: session.id };
}

/** The current session, or null. Reads the cookie, so callers must be request-time. */
export async function readSession(): Promise<SessionRecord | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await platformDb.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return { id: session.id, userId: session.userId, schoolId: session.schoolId };
}

export async function setSessionSchool(sessionId: string, schoolId: string | null): Promise<void> {
  await platformDb.session.update({ where: { id: sessionId }, data: { schoolId } });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await platformDb.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}
