/**
 * A pretend Safaricom for development and tests. `npm run mpesa:simulate` records the payments
 * it "makes" in a small JSON store, then fires realistic callbacks at the app. The app's
 * simulator driver answers status checks from the same store, so a callback for a payment the
 * simulator never made is rejected, exactly as real Daraja would.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DarajaDriver } from "./daraja";

export type SimTransaction = {
  transId: string;
  amountCents: number;
  msisdn: string;
  billRef: string;
  shortcode: string;
  time: string;
};

export type SimStk = {
  checkoutRequestId: string;
  merchantRequestId: string;
  shortcode: string;
  phone: string;
  amountShillings: number;
  accountReference: string;
  callbackUrl: string;
  status: "pending" | "completed" | "cancelled";
  transId?: string;
  createdAt: string;
};

type Store = { transactions: Record<string, SimTransaction>; stk: Record<string, SimStk> };

export function simDir() {
  return path.resolve(process.env.MPESA_SIM_DIR ?? ".dev/mpesa-sim");
}

export function readSimStore(): Store {
  try {
    return JSON.parse(readFileSync(path.join(simDir(), "store.json"), "utf8")) as Store;
  } catch {
    return { transactions: {}, stk: {} };
  }
}

export function writeSimStore(store: Store) {
  mkdirSync(simDir(), { recursive: true });
  const file = path.join(simDir(), "store.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** M-Pesa-looking IDs, e.g. "SL41H2K3XY". */
export function simTransId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return `SL${Array.from(randomBytes(8), (b) => chars[b % chars.length]).join("")}`;
}

export const simulatorDriver: DarajaDriver = {
  name: "simulator",
  async stkPush(c, r) {
    const store = readSimStore();
    const checkoutRequestId = `ws_CO_${Date.now()}${randomBytes(3).toString("hex")}`;
    const merchantRequestId = `${randomBytes(4).toString("hex")}-${Date.now()}`;
    store.stk[checkoutRequestId] = {
      checkoutRequestId,
      merchantRequestId,
      shortcode: c.shortcode,
      phone: r.phone,
      amountShillings: r.amountShillings,
      accountReference: r.accountReference,
      callbackUrl: r.callbackUrl,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    writeSimStore(store);
    return {
      checkoutRequestId,
      merchantRequestId,
      customerMessage: "Success. Request accepted for processing (simulator)",
    };
  },
  async stkQuery(_c, checkoutRequestId) {
    const stk = readSimStore().stk[checkoutRequestId];
    if (!stk) return { resultCode: "2001", resultDesc: "Unknown request (simulator)" };
    if (stk.status === "completed")
      return { resultCode: "0", resultDesc: "The service request is processed successfully." };
    if (stk.status === "cancelled")
      return { resultCode: "1032", resultDesc: "Request cancelled by user" };
    return { resultCode: "4999", resultDesc: "The transaction is still under processing" };
  },
  async checkTransaction(c, r) {
    const t = readSimStore().transactions[r.transId];
    if (!t || t.shortcode !== c.shortcode) {
      return { state: "not_found", detail: "Safaricom has no such transaction (simulator)" };
    }
    return { state: "verified", transId: t.transId, amountCents: t.amountCents };
  },
  async registerUrls() {
    // Nothing to register: the simulator reads the URLs from the school's settings.
  },
};
