/**
 * The gate phone's own storage (IndexedDB): the downloaded bundle of passes and the queue of
 * exits and returns not yet sent. Survives reloads and having no connection.
 */
import type { GatePass } from "@/lib/leaveout/gate";

export type Bundle = {
  school: { id: string; name: string };
  publicKey: string | null;
  generatedAt: string;
  /** How early before the leave time a child may go (the school's setting). */
  earlyExitMinutes?: number;
  passes: GatePass[];
};

export type QueuedEvent = {
  id: string;
  leaveoutId: string;
  kind: "exit" | "return";
  at: string;
  code?: string;
  offline: boolean;
};

const DB = "kiota-gate";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const loadBundle = () => run<Bundle | undefined>("kv", "readonly", (s) => s.get("bundle"));
export const saveBundle = (b: Bundle) => run("kv", "readwrite", (s) => s.put(b, "bundle"));
export const queued = () => run<QueuedEvent[]>("queue", "readonly", (s) => s.getAll());
export const enqueue = (e: QueuedEvent) => run("queue", "readwrite", (s) => s.put(e));
export const dequeue = (id: string) => run("queue", "readwrite", (s) => s.delete(id));
