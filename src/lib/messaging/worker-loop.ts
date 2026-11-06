/**
 * Runs the sending worker inside the app server (and the leave-out overdue and absence checks): every few seconds, and straight away when a
 * screen queues something (kickMessageWorker). Started once by src/instrumentation.ts. Safe with
 * several servers: messages are claimed with FOR UPDATE SKIP LOCKED.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { processAbsenceAlerts } from "@/lib/attendance/service";
import { checkOverdueLeaveouts } from "@/lib/leaveout/service";
import { processDueMessages } from "./worker";

let db: PrismaClient | null = null;
let running = false;
let again = false;

async function run() {
  if (!db) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    // Students not back on time first: their parents' SMS then go out in the same run.
    await checkOverdueLeaveouts(db).catch((err) =>
      console.error("[leaveouts] overdue check failed", err),
    );
    // Absence SMS whose delay has passed (unless the register was corrected in the meantime).
    await processAbsenceAlerts(db).catch((err) =>
      console.error("[attendance] absence alerts failed", err),
    );
    await processDueMessages(db);
  } catch (err) {
    console.error("[messaging] worker run failed", err);
  } finally {
    running = false;
    if (again) {
      again = false;
      void run();
    }
  }
}

export function startMessageWorker(client: PrismaClient, intervalMs = 5_000) {
  if (db) return;
  db = client;
  setInterval(run, intervalMs).unref();
  void run();
}

/** Send what was just queued without waiting for the next tick. Never blocks the caller. */
export function kickMessageWorker() {
  if (db) setTimeout(run, 50);
}
