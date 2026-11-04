/**
 * Safaricom Daraja behind one interface. Drivers:
 *  - "sandbox"    real HTTP calls to https://sandbox.safaricom.co.ke (test credentials)
 *  - "production" real HTTP calls to https://api.safaricom.co.ke
 *  - "simulator"  no network: answers from the local simulator store that
 *                 `npm run mpesa:simulate` writes to (development and tests)
 * A school's settings choose the driver.
 */
import { simulatorDriver } from "./simulator";

export type DarajaCredentials = {
  environment: "simulator" | "sandbox" | "production";
  shortcode: string;
  shortcodeType: "paybill" | "till";
  consumerKey: string | null;
  consumerSecret: string | null;
  passkey: string | null;
  initiatorName: string | null;
  securityCredential: string | null;
};

export type StkPushRequest = {
  /** 2547XXXXXXXX */
  phone: string;
  /** Whole shillings (Daraja does not take cents). */
  amountShillings: number;
  accountReference: string;
  description: string;
  callbackUrl: string;
};

export type CheckResult =
  | { state: "pending" }
  | { state: "verified"; transId: string; amountCents: number }
  | { state: "not_found"; detail: string };

export type DarajaDriver = {
  name: string;
  stkPush(
    c: DarajaCredentials,
    r: StkPushRequest,
  ): Promise<{ checkoutRequestId: string; merchantRequestId: string; customerMessage: string }>;
  /** Synchronous STK status: resultCode "0" = paid. */
  stkQuery(
    c: DarajaCredentials,
    checkoutRequestId: string,
  ): Promise<{ resultCode: string; resultDesc: string }>;
  /**
   * Confirm a C2B transaction with Safaricom. Real Daraja answers later on resultUrl
   * ("pending"); the simulator answers at once.
   */
  checkTransaction(
    c: DarajaCredentials,
    r: { transId: string; resultUrl: string; timeoutUrl: string },
  ): Promise<CheckResult>;
  registerUrls(
    c: DarajaCredentials,
    r: { confirmationUrl: string; validationUrl: string },
  ): Promise<void>;
};

const BASE = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
} as const;

/** Daraja timestamps are Nairobi local time, YYYYMMDDHHmmss. */
export function darajaTimestamp(d = new Date()) {
  const t = new Date(d.getTime() + 3 * 3600_000);
  return t.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** "20270115103045" (Nairobi time) -> Date */
export function parseDarajaTime(v: unknown): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(v ?? ""));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function need(v: string | null, what: string) {
  if (!v) throw new Error(`M-Pesa settings are missing the ${what}`);
  return v;
}

const tokens = new Map<string, { token: string; expires: number }>();

function httpDriver(environment: "sandbox" | "production"): DarajaDriver {
  const base = BASE[environment];

  async function accessToken(c: DarajaCredentials) {
    const cacheKey = `${environment}:${c.consumerKey}`;
    const hit = tokens.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.token;
    const basic = Buffer.from(
      `${need(c.consumerKey, "consumer key")}:${need(c.consumerSecret, "consumer secret")}`,
    ).toString("base64");
    const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok)
      throw new Error(`Daraja sign-in failed (${res.status}). Check the consumer key and secret.`);
    const body = (await res.json()) as { access_token: string; expires_in: string };
    tokens.set(cacheKey, {
      token: body.access_token,
      expires: Date.now() + (Number(body.expires_in) - 60) * 1000,
    });
    return body.access_token;
  }

  async function post<T>(c: DarajaCredentials, path: string, body: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(c)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
    if (!res.ok)
      throw new Error(
        `Daraja ${path} failed (${res.status}): ${json.errorMessage ?? "no details"}`,
      );
    return json;
  }

  const password = (c: DarajaCredentials, ts: string) =>
    Buffer.from(`${c.shortcode}${need(c.passkey, "passkey")}${ts}`).toString("base64");

  return {
    name: environment,
    async stkPush(c, r) {
      const ts = darajaTimestamp();
      const res = await post<{
        CheckoutRequestID: string;
        MerchantRequestID: string;
        CustomerMessage: string;
        ResponseCode: string;
      }>(c, "/mpesa/stkpush/v1/processrequest", {
        BusinessShortCode: c.shortcode,
        Password: password(c, ts),
        Timestamp: ts,
        TransactionType:
          c.shortcodeType === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
        Amount: r.amountShillings,
        PartyA: r.phone,
        PartyB: c.shortcode,
        PhoneNumber: r.phone,
        CallBackURL: r.callbackUrl,
        AccountReference: r.accountReference.slice(0, 12),
        TransactionDesc: r.description.slice(0, 13),
      });
      if (res.ResponseCode !== "0")
        throw new Error(`Safaricom did not accept the request: ${res.CustomerMessage}`);
      return {
        checkoutRequestId: res.CheckoutRequestID,
        merchantRequestId: res.MerchantRequestID,
        customerMessage: res.CustomerMessage,
      };
    },
    async stkQuery(c, checkoutRequestId) {
      const ts = darajaTimestamp();
      const res = await post<{ ResultCode: string; ResultDesc: string }>(
        c,
        "/mpesa/stkpushquery/v1/query",
        {
          BusinessShortCode: c.shortcode,
          Password: password(c, ts),
          Timestamp: ts,
          CheckoutRequestID: checkoutRequestId,
        },
      );
      return { resultCode: String(res.ResultCode), resultDesc: res.ResultDesc };
    },
    async checkTransaction(c, r) {
      await post(c, "/mpesa/transactionstatus/v1/query", {
        Initiator: need(c.initiatorName, "initiator name"),
        SecurityCredential: need(c.securityCredential, "security credential"),
        CommandID: "TransactionStatusQuery",
        TransactionID: r.transId,
        PartyA: c.shortcode,
        IdentifierType: "4",
        ResultURL: r.resultUrl,
        QueueTimeOutURL: r.timeoutUrl,
        Remarks: "Kiota payment check",
        Occasion: "Fees",
      });
      return { state: "pending" };
    },
    async registerUrls(c, r) {
      await post(c, "/mpesa/c2b/v2/registerurl", {
        ShortCode: c.shortcode,
        ResponseType: "Completed",
        ConfirmationURL: r.confirmationUrl,
        ValidationURL: r.validationUrl,
      });
    },
  };
}

let override: DarajaDriver | null = null;

/** Tests can replace the driver (e.g. to simulate Daraja being down). */
export function setDarajaDriverForTests(driver: DarajaDriver | null) {
  override = driver;
}

export function darajaDriver(environment: DarajaCredentials["environment"]): DarajaDriver {
  if (override) return override;
  if (environment === "simulator") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_MPESA_SIMULATOR !== "1") {
      throw new Error("The M-Pesa simulator is not allowed in production");
    }
    return simulatorDriver;
  }
  return httpDriver(environment);
}
