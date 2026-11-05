import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { platformDb } from "@/lib/db";

/**
 * Sessions: the cookie holds a random token (httpOnly, Secure in production, SameSite=Lax).
 * The database stores only its SHA-256 hash, the user, the school they chose, whether they are
 * working as staff or as a parent (for people who are both), and the browser.
 */
export const SESSION_COOKIE = "kiota_session";
const SESSION_DAYS = 30;
/** "Last used" is refreshed at most this often (not on every request). */
const TOUCH_MS = 10 * 60 * 1000;

export type SessionMode = "staff" | "parent";

export type SessionRecord = {
  id: string;
  userId: string;
  schoolId: string | null;
  mode: SessionMode | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const asMode = (m: string | null): SessionMode | null =>
  m === "staff" || m === "parent" ? m : null;

export async function createSession(userId: string): Promise<{ id: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const session = await platformDb.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, userAgent, lastSeenAt: new Date() },
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
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > TOUCH_MS) {
    await platformDb.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }
  return {
    id: session.id,
    userId: session.userId,
    schoolId: session.schoolId,
    mode: asMode(session.mode),
  };
}

export async function setSessionSchool(sessionId: string, schoolId: string | null): Promise<void> {
  await platformDb.session.update({ where: { id: sessionId }, data: { schoolId } });
}

export async function setSessionMode(sessionId: string, mode: SessionMode): Promise<void> {
  await platformDb.session.update({ where: { id: sessionId }, data: { mode } });
}

/** The user's live sessions, newest first (for "where you are signed in"). */
export async function listSessions(userId: string) {
  return platformDb.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Sign out on every device, this one included. */
export async function destroyAllSessions(userId: string): Promise<number> {
  const { count } = await platformDb.session.deleteMany({ where: { userId } });
  (await cookies()).delete(SESSION_COOKIE);
  return count;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await platformDb.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}
