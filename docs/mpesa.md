# M-Pesa in Kiota

Each school has its own Paybill (or Till) and its own Daraja credentials, saved under
**Fees → M-Pesa settings** by the Bursar or Director. Secrets are encrypted at rest with
`CREDENTIALS_ENCRYPTION_KEY` and never shown again after saving.

## How a payment reaches a student

**Paybill (C2B).** A parent pays the school's Paybill with the admission number as the account
number. Safaricom calls Kiota's confirmation URL. Kiota:

1. finds the school from the secret token in the URL (the URL is the only thing that identifies
   it; Safaricom does not sign callbacks);
2. records the transaction once: the M-Pesa transaction ID is unique per school, so the same
   callback twice (or at the same moment) never creates two payments;
3. **asks Safaricom to confirm it** with the Transaction Status query. Daraja answers on the
   status result URL; only a confirmed transaction with the same amount is posted;
4. matches the account number to a student's admission number, ignoring case, spaces and symbols
   (`ba2025001`, `BA/2025/001` and `BA 2025 001` all match), posts the payment with a receipt,
   allocating it to vote heads by the school's priority order;
5. if no single student matches, puts it in **suspense** (Fees → M-Pesa) for the Bursar to
   assign. Assigning issues the receipt.

**STK Push.** Staff send a payment prompt to a parent's phone (Fees → M-Pesa, or the student's
profile). When Safaricom calls back, Kiota confirms with the STK query and posts the payment to
that student. For a Paybill, Safaricom usually also sends a C2B confirmation for the same
payment: whichever arrives first is posted, the other is recognised as a duplicate.

The callback URLs look like `https://app.kiota.app/api/pay/<secret>/c2b/confirm`. Daraja refuses
URLs containing words such as "mpesa" or "query", which is why the path is `/api/pay/...`.

## 1. Simulator (this computer, no Safaricom)

The seeded Bahari Academy is set to **Simulator**. With `npm run dev` running:

```bash
npm run mpesa:simulate -- c2b --account BA/2025/001 --amount 5000
```

```bash
npm run mpesa:simulate -- c2b --account NOSUCH --amount 1500
```

```bash
npm run mpesa:simulate -- repeat --trans SLXXXXXXXX
```

```bash
npm run mpesa:simulate -- fake --account BA/2025/001 --amount 9999
```

```bash
npm run mpesa:simulate -- stk
```

`c2b` pays the Paybill (the receipt appears under Fees → Payments); an unknown account lands in
suspense; `repeat` re-sends a callback (no second payment); `fake` sends a callback Safaricom
never saw (Kiota rejects it); `stk` completes the latest prompt you sent from Fees → M-Pesa
(`stk --cancel` cancels it). Options: `--school "Bahari Academy"`, `--phone`, `--name`,
`--base http://localhost:3000`.

The simulator keeps its "Safaricom records" in `.dev/mpesa-sim/store.json`. It is refused in
production unless `ALLOW_MPESA_SIMULATOR=1` (end-to-end tests only).

## 2. The real Daraja sandbox, from this computer

### What you need from the Daraja portal

1. Sign up at **developer.safaricom.co.ke** and log in.
2. **My Apps → Add a new app.** Tick _Lipa Na M-Pesa Sandbox_ (M-Pesa Express/STK Push),
   _M-Pesa Sandbox_ (C2B) and _Transaction Status_. Open the app: copy the **Consumer Key** and
   **Consumer Secret**.
3. **APIs → (any) → Simulate → test credentials** (or the "Test Credentials" page). Copy:
   - the **business shortcode** for C2B (a 6-digit Paybill such as `600xxx`);
   - the **Lipa Na M-Pesa Online shortcode** (`174379`) and its **passkey** for STK Push;
   - the **initiator name** (e.g. `testapi`) and **initiator password**;
   - a **test phone number** (MSISDN).
4. Still on the test credentials page, use **Generate security credential**: paste the initiator
   password; copy the long result. That is the **security credential** (the initiator password
   encrypted with Safaricom's certificate).

The sandbox uses one shortcode for C2B and another (174379) for STK Push, while a school in Kiota
has one shortcode. Test C2B with the C2B shortcode, then change the shortcode to 174379 to test
STK Push. A real school uses one Paybill for both.

### A public address with a free Cloudflare quick tunnel

Safaricom must reach your computer over HTTPS. A quick tunnel needs no account.

1. Install cloudflared (Windows):

   ```bash
   winget install --id Cloudflare.cloudflared
   ```

2. Start Kiota (`npm run dev`), then in another terminal:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   It prints an address like `https://quiet-river-1234.trycloudflare.com`. Keep it running.

3. In `.env`, set that address as the callback base and restart `npm run dev`:

   ```
   MPESA_CALLBACK_BASE_URL="https://quiet-river-1234.trycloudflare.com"
   ```

   (Callbacks are served on any address, so the tunnel works even though the app itself is on
   `app.localhost`.)

4. Sign in as the Bursar (0711 000 002) → **Fees → M-Pesa settings**: choose **Daraja sandbox**,
   enter the shortcode, consumer key and secret, passkey, initiator name and security credential.
   **Save**, then **Register with Safaricom** (registers the C2B confirmation/validation URLs).
   The page lists every callback URL; they now start with your tunnel address.

5. **Test C2B:** in the Daraja portal, open _C2B → Simulate_ (or call the sandbox
   `/mpesa/c2b/v1/simulate` API) with your shortcode, an amount, the test MSISDN and a seeded
   admission number (e.g. `BA/2025/001`) as the bill reference. Kiota receives the confirmation,
   asks Safaricom to confirm it, and posts it when the status result arrives (Fees → Payments).
   A wrong bill reference ends up in suspense.

6. **Test STK Push:** set the shortcode to `174379` (and its passkey), save, then **Fees →
   M-Pesa → Send an M-Pesa prompt** to your own Safaricom number. The sandbox may send a real
   prompt to that phone; enter your PIN to complete it. Check Safaricom's sandbox notes for the
   current behaviour and limits.

**Every quick tunnel gets a new address**: update `MPESA_CALLBACK_BASE_URL`, restart, and press
**Register with Safaricom** again each time. Quick tunnels are for testing only.

If nothing arrives: check the cloudflared window for incoming requests, `npm run dev` output for
`[mpesa]` errors, and Fees → M-Pesa for items "Could not confirm" (use _Check with Safaricom
again_).

## 3. Going live (per school)

See [docs/launch-checklist.md](launch-checklist.md), "Before real money flows". In short: the
school's Paybill goes through Safaricom's **Go Live** process on the Daraja portal, which issues
production credentials; set the environment to **Live**, save, register the URLs, and test with
a small real payment and a reversal before telling parents.
