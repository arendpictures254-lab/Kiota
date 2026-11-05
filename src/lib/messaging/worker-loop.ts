/**
 * Runs the sending worker inside the app server: every few seconds, and straight away when a
 * screen queues something (kickMessageWorker). Started once by src/instrumentation.ts. Safe with
 * several servers: messages are claimed with FOR UPDATE SKIP LOCKED.
 */
import type { PrismaClient } from "@/generated/prisma/client";
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
