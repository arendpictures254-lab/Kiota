/**
 * Pretend to be Safaricom: fire realistic M-Pesa callbacks at a running Kiota.
 * The school's M-Pesa settings must use the "Simulator" environment.
 *
 *   npm run mpesa:simulate -- c2b --account BA/2025/001 --amount 5000
 *   npm run mpesa:simulate -- c2b --account NOSUCH --amount 1500        (goes to suspense)
 *   npm run mpesa:simulate -- repeat --trans SLXXXXXXXX                  (duplicate callback)
 *   npm run mpesa:simulate -- fake --account BA/2025/001 --amount 9999   (Safaricom never saw it)
 *   npm run mpesa:simulate -- stk                                        (parent pays latest prompt)
 *   npm run mpesa:simulate -- stk --cancel                               (parent cancels it)
 *   npm run mpesa:simulate -- topup                       (Director pays the latest wallet top-up)
 *   npm run mpesa:simulate -- topup --cancel              (Director cancels it)
 *   npm run mpesa:simulate -- list
 *
 * Wallet top-ups go to Arend Studio's own Paybill (PLATFORM_MPESA_* in .env, environment
 * "simulator"), not to a school, so `topup` needs no --school.
 *
 * Options: --school "Bahari Academy" (default: the only/first school with M-Pesa settings),
 *          --base http://localhost:3000, --phone 0712345678, --name "MARY OTIENO"
 */
import "dotenv/config";
import { decryptSecret } from "../src/lib/crypto";
import { createClient } from "../src/lib/db-core";
import { darajaTimestamp } from "../src/lib/mpesa/daraja";
import { type SimStk, readSimStore, simTransId, writeSimStore } from "../src/lib/mpesa/simulator";
import { normalizePhone } from "../src/lib/phone";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function school() {
  const owner = createClient(process.env.DATABASE_URL);
  try {
    const name = arg("school");
    const rows = await owner.mpesaSettings.findMany();
    const schools = await owner.school.findMany({
      where: { id: { in: rows.map((r) => r.schoolId) } },
    });
    const chosen = name
      ? schools.find((s) => s.name.toLowerCase() === name.toLowerCase())
      : schools[0];
    if (!chosen)
      throw new Error(
        name
          ? `No school called "${name}" has M-Pesa settings`
          : "No school has M-Pesa settings yet",
      );
    const settings = rows.find((r) => r.schoolId === chosen.id)!;
    if (settings.environment !== "simulator") {
      console.warn(
        `Warning: ${chosen.name} uses the "${settings.environment}" environment, so Kiota will check these with real Daraja and reject them.`,
      );
    }
    return {
      name: chosen.name,
      shortcode: settings.shortcode,
      token: decryptSecret(settings.callbackTokenEnc),
    };
  } finally {
    await owner.$disconnect();
  }
}

async function send(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`  -> ${res.status} ${text}`);
}

function c2bBody(transId: string, amount: number, account: string, shortcode: string) {
  const phone = normalizePhone(arg("phone", "0712345678")!) ?? "+254712345678";
  const [first, ...rest] = (arg("name", "MARY OTIENO") ?? "").split(" ");
  return {
    TransactionType: "Pay Bill",
    TransID: transId,
    TransTime: darajaTimestamp(),
    TransAmount: amount.toFixed(2),
    BusinessShortCode: shortcode,
    BillRefNumber: account,
    InvoiceNumber: "",
    OrgAccountBalance: "",
    ThirdPartyTransID: "",
    MSISDN: phone.slice(1),
    FirstName: first,
    MiddleName: "",
    LastName: rest.join(" "),
  };
}

/** The person answers the STK prompt on their phone: pay (default) or --cancel. */
async function finishStk(store: ReturnType<typeof readSimStore>, stk: SimStk, base: string) {
  const callback = (body: unknown) => {
    // Real Daraja calls the URL in the request; send it to this computer's server instead.
    const u = new URL(stk.callbackUrl);
    return send(`${base}${u.pathname}`, body);
  };
  if (flag("cancel")) {
    stk.status = "cancelled";
    writeSimStore(store);
    console.log(`Cancelled on the phone: ${stk.checkoutRequestId}`);
    await callback({
      Body: {
        stkCallback: {
          MerchantRequestID: stk.merchantRequestId,
          CheckoutRequestID: stk.checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user",
        },
      },
    });
    return;
  }
  const transId = simTransId();
  stk.status = "completed";
  stk.transId = transId;
  store.transactions[transId] = {
    transId,
    amountCents: stk.amountShillings * 100,
    msisdn: stk.phone,
    billRef: stk.accountReference,
    shortcode: stk.shortcode,
    time: new Date().toISOString(),
  };
  writeSimStore(store);
  console.log(`Paid KES ${stk.amountShillings} from ${stk.phone}: ${transId}`);
  await callback({
    Body: {
      stkCallback: {
        MerchantRequestID: stk.merchantRequestId,
        CheckoutRequestID: stk.checkoutRequestId,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: stk.amountShillings },
            { Name: "MpesaReceiptNumber", Value: transId },
            { Name: "TransactionDate", Value: Number(darajaTimestamp()) },
            { Name: "PhoneNumber", Value: Number(stk.phone) },
          ],
        },
      },
    },
  });
}

async function main() {
  const command = process.argv[2];
  const base = (
    arg("base", process.env.SIMULATOR_BASE_URL ?? "http://localhost:3000") ?? ""
  ).replace(/\/$/, "");
  const store = readSimStore();

  if (command === "list") {
    console.log(JSON.stringify(store, null, 2));
    return;
  }

  if (command === "topup") {
    const shortcode = process.env.PLATFORM_MPESA_SHORTCODE;
    if (!shortcode) throw new Error("Set PLATFORM_MPESA_* in .env (see .env.example)");
    const id = arg("checkout");
    const pending = Object.values(store.stk)
      .filter((x) => x.status === "pending" && x.shortcode === shortcode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const stk = id ? store.stk[id] : pending[0];
    if (!stk)
      throw new Error(
        "No top-up prompt is waiting. Start one from Messages → Wallet → Top up first.",
      );
    console.log(`Wallet top-up to Arend Studio's Paybill ${shortcode}:`);
    await finishStk(store, stk, base);
    return;
  }

  const s = await school();
  const url = (path: string) => `${base}/api/pay/${s.token}${path}`;

  if (command === "c2b" || command === "fake") {
    const account = arg("account");
    const amount = Number(arg("amount"));
    if (!account || !Number.isFinite(amount) || amount <= 0)
      throw new Error("Use --account <admission number> --amount <shillings>");
    const transId = arg("trans", simTransId())!.toUpperCase();
    const body = c2bBody(transId, amount, account, s.shortcode);
    if (command === "c2b") {
      store.transactions[transId] = {
        transId,
        amountCents: Math.round(amount * 100),
        msisdn: body.MSISDN,
        billRef: account,
        shortcode: s.shortcode,
        time: new Date().toISOString(),
      };
      writeSimStore(store);
    }
    console.log(
      `${command === "fake" ? "FAKE (Safaricom never saw it)" : "Paybill payment"} ${transId}: KES ${amount} to ${s.name} (${s.shortcode}), account "${account}"`,
    );
    await send(url("/c2b/confirm"), body);
    return;
  }

  if (command === "repeat") {
    const transId = arg("trans")?.toUpperCase();
    const t = transId ? store.transactions[transId] : undefined;
    if (!t) throw new Error("Use --trans <transaction ID> of an earlier simulated payment");
    console.log(`Sending the callback for ${transId} again`);
    await send(
      url("/c2b/confirm"),
      c2bBody(t.transId, t.amountCents / 100, t.billRef, t.shortcode),
    );
    return;
  }

  if (command === "stk") {
    const id = arg("checkout");
    const pending = Object.values(store.stk)
      .filter((x) => x.status === "pending" && x.shortcode === s.shortcode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const stk = id ? store.stk[id] : pending[0];
    if (!stk)
      throw new Error("No STK prompt is waiting. Send one from Fees → Send M-Pesa prompt first.");
    await finishStk(store, stk, base);
    return;
  }

  console.log(
    "Commands: c2b, fake, repeat, stk, topup, list. See the top of scripts/mpesa-simulate.ts.",
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
