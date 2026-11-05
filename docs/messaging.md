# Messaging in Kiota: SMS, WhatsApp and the wallet

Each school sends SMS and WhatsApp to parents from one prepaid **messaging wallet** that Arend
Studio sells at a margin. Sign-in codes and Kiota's own alerts are **platform messages**: they go
out under Kiota's sender ID, are paid by Arend Studio and never touch a school's wallet.

## How a message travels

1. A screen (a payment, a fee reminder, a notice) **plans** the messages: who gets them (each
   guardian's settings: fees, academics, boarding), in which language (English or Kiswahili),
   by SMS or WhatsApp, how many SMS units and what it costs at the school's price.
2. Bulk sends show a **cost preview** first: parents, units, total cost, balance after. The send is
   refused if the cost changed since the preview.
3. The messages are **queued** with their cost **reserved** from the wallet, in the same
   transaction. An empty wallet stops everything except **critical** messages (leave-out alerts,
   emergencies), which may use the small overdraft Arend Studio sets per school. Payment
   confirmations to an empty wallet are recorded as "not sent" at no cost.
4. The **worker** (started with the server, `src/instrumentation.ts`) sends queued messages in the
   background, so no screen waits for a provider. Network failures are retried with back-off
   (up to 5 attempts); a final failure is **refunded**.
5. **Quiet hours:** nothing non-critical goes out between 21:00 and 07:00 Nairobi time; it waits
   for 07:00.
6. **Delivery reports** from Africa's Talking or Meta move each message to delivered (cost kept)
   or failed (cost refunded). A WhatsApp message that fails is sent again by SMS automatically.

Every money step is an append-only `wallet_entries` row (integer cents; the balance is the sum),
every school-owned table has row-level security, and top-ups, price changes and sends are in the
audit log.

**SMS units.** Plain text (GSM-7) fits 160 characters in one SMS, 153 per part when longer. One
emoji or curly quote switches the whole message to Unicode: 70 characters, 67 per part. The
composer shows the count live, warns above one unit, and names the characters that forced
Unicode so the writer can replace them.

## Who can do what

| Action                                                | Permission           | Built-in roles      |
| ----------------------------------------------------- | -------------------- | ------------------- |
| Send notices (and fee reminders)                      | `messages.send`      | Director, Principal |
| Send fee reminders                                    | `messages.send.fees` | Bursar              |
| See every message from the school                     | `messages.view_all`  | Director            |
| Top up, set the low-balance alert                     | `wallet.topup`       | Director, Bursar    |
| Prices, overdraft, sender ID, credit, template status | Arend admin only     | —                   |

Others with access to messages see only messages about students they can see (a class teacher:
their own streams).

## Trying it on this computer

With `npm run dev` running and the database seeded (each demo school has credit and a history):

```bash
# Delivery reports for the SMS the console driver "sent" (.dev/sms-outbox.log)
npm run sms:simulate                      # every SMS not yet reported: delivered
npm run sms:simulate -- fail --to 0712345678 --reason AbsentSubscriber
npm run sms:simulate -- list

# Wallet top-up: Messages → Wallet → Send M-Pesa prompt, then
npm run mpesa:simulate -- topup           # the Director pays (or: topup --cancel)
```

`.env` needs `SMS_CALLBACK_TOKEN` and the `PLATFORM_MPESA_*` lines from `.env.example`. WhatsApp
in development prints to the server console (`WHATSAPP_DRIVER=console`, the default outside
production).

## What we need from Africa's Talking (SMS)

1. **An Africa's Talking account for Arend Studio**, verified (business registration documents,
   KRA PIN, director's ID). Create an app and note its **username**.
2. **An API key** for that app (Settings → API Key). It is shown once: store it in the password
   manager.
3. **Test in the sandbox first:** `AT_ENVIRONMENT=sandbox`, `AT_USERNAME=sandbox`, the sandbox
   API key, and the AT simulator app to receive the messages.
4. **Sender IDs**, applied for through Africa's Talking, approved by Safaricom, Airtel and Telkom.
   Allow **2 to 4 weeks** each, and some cost per network:
   - **KIOTA** for Arend Studio's own messages (sign-in codes): `SMS_PLATFORM_SENDER_ID=KIOTA`.
   - **One per school**, for example `BAHARI` (up to 11 letters or digits). Each school writes a
     letter on its letterhead authorising Arend Studio to send under that name. When approved,
     the Arend admin enters it under **Admin → Messaging wallets** and ticks "approved". Until
     then the school's messages go under the default sender.
5. **Delivery reports:** in the AT dashboard (SMS → Callback URLs → Delivery Reports) set
   `https://app.kiota.app/api/hooks/sms/<SMS_CALLBACK_TOKEN>`, with a long random token
   (`openssl rand -hex 24`) also set as `SMS_CALLBACK_TOKEN` on the server.
6. **Prepaid SMS credit** on the Africa's Talking account, topped up ahead of term openings, and
   AT's own low-balance alert switched on. Kiota's prices per school (Admin → Messaging wallets)
   must stay above AT's rate per unit.
7. Production settings: `SMS_DRIVER=africastalking`, `AT_ENVIRONMENT=live`, `AT_USERNAME`,
   `AT_API_KEY`. The server refuses to start in production with the console driver or
   `ALLOW_CONSOLE_SMS=1` (unless `KIOTA_DEMO=1` marks a demo server).

## What we need from Meta (WhatsApp)

1. **Meta Business verification** for Arend Studio in Meta Business Manager (business documents,
   a website on the business's domain, a phone or email check). Often 1 to 2 weeks.
2. **A WhatsApp Business phone number** that is not used in the WhatsApp app, added to the
   WhatsApp Business Account, with the display name "Kiota" approved.
3. **A permanent access token:** a system user in Business Manager with the
   `whatsapp_business_messaging` permission (`WHATSAPP_TOKEN`), and the number's **phone number
   ID** (`WHATSAPP_PHONE_NUMBER_ID`).
4. **Webhook:** in the Meta app, set the callback URL `https://app.kiota.app/api/hooks/whatsapp`
   and a verify token (`WHATSAPP_VERIFY_TOKEN`, any random string), subscribe to `messages`, and
   set the app secret as `WHATSAPP_APP_SECRET` (Kiota checks the signature on every webhook).
5. **Template approval.** Submit each template in **English (`en`) and Kiswahili (`sw`)**, category
   Utility. The exact wording is in the `message_templates` table (seeded by the messaging
   migration). When Meta approves one, the Arend admin marks it approved under **Admin →
   Messaging wallets → WhatsApp templates**; until then those messages go by SMS.

   | Template                | Used for                               | Header   |
   | ----------------------- | -------------------------------------- | -------- |
   | `kiota_payment_receipt` | Payment received, with the receipt PDF | Document |
   | `kiota_fee_reminder`    | Fee balance and due date               | —        |
   | `kiota_notice`          | Notices from the school                | —        |
   | `kiota_report_card`     | Report card ready, with a link         | —        |
   | `kiota_leaveout_alert`  | Child left or returned (critical)      | —        |

6. **Pricing:** Meta charges per conversation by category; set each school's WhatsApp price
   (Admin → Messaging wallets) above it.
7. Production settings: `WHATSAPP_DRIVER=cloud` plus the four secrets above. Without them, set
   `WHATSAPP_DRIVER=off` (the production default): everything goes by SMS.

## What we need from Safaricom (Arend Studio's own Paybill)

School wallet top-ups are paid to **Arend Studio's own Paybill or Till**, never to a school's fee
Paybill. That needs:

1. **A Paybill (or Till) number in Arend Studio's name**, applied for at Safaricom with the
   business registration, KRA PIN, the directors' IDs and a bank account for settlement.
2. **A Daraja app** on the Safaricom developer portal with the M-Pesa Express (STK Push) product,
   then **Go Live** for that shortcode: production consumer key and secret, and the **Lipa na
   M-Pesa Online passkey** Safaricom emails after Go Live.
3. Production settings: `PLATFORM_MPESA_ENVIRONMENT=production`, `PLATFORM_MPESA_SHORTCODE`,
   `PLATFORM_MPESA_SHORTCODE_TYPE` (`paybill` or `till`), `PLATFORM_MPESA_CONSUMER_KEY`,
   `PLATFORM_MPESA_CONSUMER_SECRET`, `PLATFORM_MPESA_PASSKEY`, and a long random
   `PLATFORM_MPESA_CALLBACK_TOKEN` (`openssl rand -hex 24`). Safaricom calls
   `https://app.kiota.app/api/pay/topup/<token>/stk`.
4. Test with the Daraja sandbox first (`PLATFORM_MPESA_ENVIRONMENT=sandbox`, shortcode 174379
   and the sandbox passkey) through a tunnel, as in docs/mpesa.md.

The M-Pesa module's safety rules apply: the secret token in the URL, every top-up confirmed with
Safaricom's STK query before it is credited, and each top-up credited once however many callbacks
arrive. Bank transfers are credited by the Arend admin with the bank reference (Admin → Messaging
wallets → Add credit), as is starter credit.
