/**
 * Quiet hours: nothing non-critical goes to parents between 21:00 and 07:00 Nairobi time.
 * A message queued then waits for 07:00. Critical messages (leave-out alerts, emergencies) go
 * at once. Pure; Kenya has no daylight saving, so Nairobi is always UTC+3.
 *
 * QUIET_HOURS="21-7" (default) or "off" (end-to-end tests, which run at any hour).
 */

const NAIROBI_OFFSET_MS = 3 * 3600_000;

export function quietHours(env = process.env.QUIET_HOURS): { start: number; end: number } | null {
  if (env === "off") return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(env ?? "");
  if (m) return { start: Number(m[1]) % 24, end: Number(m[2]) % 24 };
  return { start: 21, end: 7 };
}

export function nairobiHour(d: Date): number {
  return new Date(d.getTime() + NAIROBI_OFFSET_MS).getUTCHours();
}

export function inQuietHours(d: Date, q = quietHours()): boolean {
  if (!q) return false;
  const h = nairobiHour(d);
  return q.start > q.end ? h >= q.start || h < q.end : h >= q.start && h < q.end;
}

/** When a message may go: now, or the end of quiet hours (07:00 Nairobi) if it is not critical. */
export function nextSendTime(now: Date, critical: boolean, q = quietHours()): Date {
  if (critical || !q || !inQuietHours(now, q)) return now;
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  let end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), q.end);
  if (end <= local.getTime()) end += 86_400_000;
  return new Date(end - NAIROBI_OFFSET_MS);
}
