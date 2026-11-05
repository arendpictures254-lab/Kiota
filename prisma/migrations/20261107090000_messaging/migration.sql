-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('topup', 'manual_topup', 'starter_credit', 'reserve', 'refund', 'adjustment');

-- AlterTable
ALTER TABLE "guardian_links" ADD COLUMN     "whatsapp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "wallets" (
    "school_id" UUID NOT NULL,
    "sms_unit_price_cents" INTEGER NOT NULL DEFAULT 100,
    "whatsapp_price_cents" INTEGER NOT NULL DEFAULT 150,
    "overdraft_limit_cents" INTEGER NOT NULL DEFAULT 20000,
    "low_balance_threshold_cents" INTEGER NOT NULL DEFAULT 50000,
    "low_balance_alerted_at" TIMESTAMPTZ(3),
    "sender_id" VARCHAR(11),
    "sender_id_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "message_id" UUID,
    "topup_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_topups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "status_detail" TEXT,
    "phone" TEXT,
    "checkout_request_id" TEXT,
    "trans_id" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "requested_by_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "key" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "sms_body" TEXT NOT NULL,
    "whatsapp_name" TEXT,
    "whatsapp_body" TEXT,
    "whatsapp_params" TEXT[],
    "whatsapp_header" TEXT,
    "whatsapp_status" TEXT NOT NULL DEFAULT 'not_submitted',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("key","language")
);

-- CreateTable
CREATE TABLE "message_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "body_sw" TEXT,
    "audience" JSONB NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "category" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "recipients" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "campaign_id" UUID,
    "student_id" UUID,
    "guardian_link_id" UUID,
    "to_phone" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "language" "Language" NOT NULL,
    "template_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "params" JSONB,
    "media_url" TEXT,
    "units" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "provider" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "fallback_to_sms" BOOLEAN NOT NULL DEFAULT false,
    "fallback_of_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_topup_id_key" ON "wallet_entries"("topup_id");

-- CreateIndex
CREATE INDEX "wallet_entries_school_id_created_at_idx" ON "wallet_entries"("school_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_message_id_type_key" ON "wallet_entries"("message_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topups_checkout_request_id_key" ON "wallet_topups"("checkout_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topups_trans_id_key" ON "wallet_topups"("trans_id");

-- CreateIndex
CREATE INDEX "wallet_topups_school_id_created_at_idx" ON "wallet_topups"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "message_campaigns_school_id_created_at_idx" ON "message_campaigns"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_school_id_created_at_idx" ON "messages"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_status_next_attempt_at_idx" ON "messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "messages_student_id_idx" ON "messages"("student_id");

-- CreateIndex
CREATE INDEX "messages_guardian_link_id_idx" ON "messages"("guardian_link_id");

-- CreateIndex
CREATE INDEX "messages_campaign_id_idx" ON "messages"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_provider_provider_message_id_key" ON "messages"("provider", "provider_message_id");

-- ===========================================================================
-- Messaging: school walls, the append-only wallet ledger and privileged helpers.
-- Written by hand (see CLAUDE.md, "School walls").
-- ===========================================================================

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "wallets"("school_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "wallets"("school_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE wallets ADD CONSTRAINT wallets_amounts_check CHECK (
  sms_unit_price_cents >= 0 AND whatsapp_price_cents >= 0
  AND overdraft_limit_cents >= 0 AND low_balance_threshold_cents >= 0
);
ALTER TABLE wallet_entries ADD CONSTRAINT wallet_entries_amount_check CHECK (amount_cents <> 0);
ALTER TABLE wallet_topups ADD CONSTRAINT wallet_topups_amount_check CHECK (amount_cents > 0);
ALTER TABLE messages ADD CONSTRAINT messages_cost_check CHECK (cost_cents >= 0 AND units >= 0);

-- Every school has exactly one wallet, created with the school (prices start at the defaults).
CREATE FUNCTION kiota_create_wallet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO wallets (school_id) VALUES (NEW.id) ON CONFLICT (school_id) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER schools_create_wallet AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION kiota_create_wallet();
INSERT INTO wallets (school_id) SELECT id FROM schools ON CONFLICT (school_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Wallets: the school reads its wallet and sets only its low-balance alert. Prices, overdraft
-- and the sender ID change only through app_admin_set_wallet() (Arend admins).
GRANT SELECT ON wallets TO kiota_app;
GRANT UPDATE (low_balance_threshold_cents, low_balance_alerted_at, updated_at) ON wallets TO kiota_app;
-- The wallet ledger and campaigns are append-only.
GRANT SELECT, INSERT ON wallet_entries, message_campaigns TO kiota_app;
-- Top-up requests and messages change status as they progress (they are not money records).
GRANT SELECT, INSERT, UPDATE ON wallet_topups, messages TO kiota_app;
-- Templates are platform configuration: everyone reads, only Arend admins edit (policy below).
GRANT SELECT ON message_templates TO kiota_app;
GRANT UPDATE (sms_body, whatsapp_name, whatsapp_body, whatsapp_status, updated_at)
  ON message_templates TO kiota_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','wallet_entries','wallet_topups','message_campaigns','messages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['wallets','wallet_entries','wallet_topups','message_campaigns'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (school_id = (SELECT app_current_school())) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['wallet_entries','message_campaigns'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kiota_append_only()',
      t || '_append_only', t);
  END LOOP;
END
$$;

-- Messages: the Director (messages.view_all) sees every message; everyone else sees messages
-- about students they can see (the students policy: all, or a class teacher's own streams).
CREATE POLICY messages_select ON messages FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('messages.view_all'))
      OR (student_id IS NOT NULL AND EXISTS (SELECT 1 FROM students s WHERE s.id = messages.student_id))
    )
  );
-- Anyone working in the school may queue a message (a payment queues its confirmation); the
-- services decide who may send what.
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()));
-- Only the sending worker and delivery reports (messages.view_all) change a message.
CREATE POLICY messages_update ON messages FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('messages.view_all')))
  WITH CHECK (school_id = (SELECT app_current_school()));

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY message_templates_read ON message_templates FOR SELECT USING (true);
CREATE POLICY message_templates_admin ON message_templates FOR UPDATE
  USING ((SELECT app_is_platform_admin()))
  WITH CHECK ((SELECT app_is_platform_admin()));

-- ---------------------------------------------------------------------------
-- Narrow privileged helpers (SECURITY DEFINER, PL/pgSQL)
-- ---------------------------------------------------------------------------

-- Sending worker: which schools have messages due. School ids only, no school data.
CREATE FUNCTION app_due_message_schools(p_now timestamptz) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT m.school_id FROM messages m
  WHERE (m.status = 'queued' AND m.next_attempt_at <= p_now)
     OR (m.status = 'sending' AND m.locked_at < p_now - interval '10 minutes');
END
$$;

-- Delivery reports (unsigned SMS callbacks, signed WhatsApp webhooks): whose message is this?
CREATE FUNCTION app_message_school(p_provider text, p_provider_message_id text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v uuid;
BEGIN
  SELECT school_id INTO v FROM messages
  WHERE provider = p_provider AND provider_message_id = p_provider_message_id;
  RETURN v;
END
$$;

-- Wallet top-up STK callback (Arend Studio's own Paybill): which school asked for this prompt?
CREATE FUNCTION app_wallet_topup_school(p_checkout_request_id text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v uuid;
BEGIN
  SELECT school_id INTO v FROM wallet_topups WHERE checkout_request_id = p_checkout_request_id;
  RETURN v;
END
$$;

-- Arend admin: every school's wallet, balance and this month's usage (Nairobi months).
CREATE FUNCTION app_admin_wallets()
RETURNS TABLE (
  school_id uuid, name text, short_name text, status text,
  balance_cents bigint, used_this_month_cents bigint, messages_this_month bigint,
  sms_unit_price_cents int, whatsapp_price_cents int, overdraft_limit_cents int,
  low_balance_threshold_cents int, sender_id text, sender_id_approved boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month timestamptz :=
    date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi';
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.short_name::text, s.status::text,
    coalesce((SELECT sum(e.amount_cents) FROM wallet_entries e WHERE e.school_id = s.id), 0)::bigint,
    coalesce((SELECT -sum(e.amount_cents) FROM wallet_entries e
              WHERE e.school_id = s.id AND e.type IN ('reserve','refund','adjustment')
                AND e.created_at >= v_month), 0)::bigint,
    (SELECT count(*) FROM messages m WHERE m.school_id = s.id AND m.created_at >= v_month)::bigint,
    w.sms_unit_price_cents, w.whatsapp_price_cents, w.overdraft_limit_cents,
    w.low_balance_threshold_cents, w.sender_id::text, w.sender_id_approved
  FROM schools s JOIN wallets w ON w.school_id = s.id
  ORDER BY s.name;
END
$$;

-- Arend admin: prices, overdraft and sender ID of one school's wallet. Audited in the school's log.
CREATE FUNCTION app_admin_set_wallet(
  p_school uuid, p_sms_unit_price_cents int, p_whatsapp_price_cents int,
  p_overdraft_limit_cents int, p_sender_id text, p_sender_id_approved boolean, p_ip text
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_before jsonb;
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'smsUnitPriceCents', sms_unit_price_cents, 'whatsappPriceCents', whatsapp_price_cents,
    'overdraftLimitCents', overdraft_limit_cents, 'senderId', sender_id,
    'senderIdApproved', sender_id_approved
  ) INTO v_before FROM wallets WHERE school_id = p_school;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'school not found' USING ERRCODE = '22023';
  END IF;
  UPDATE wallets SET
    sms_unit_price_cents = p_sms_unit_price_cents,
    whatsapp_price_cents = p_whatsapp_price_cents,
    overdraft_limit_cents = p_overdraft_limit_cents,
    sender_id = nullif(p_sender_id, ''),
    sender_id_approved = p_sender_id_approved AND nullif(p_sender_id, '') IS NOT NULL,
    updated_at = now()
  WHERE school_id = p_school;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, before, after, ip)
  VALUES (
    p_school, app_user_id(), 'wallet.settings', 'wallet', p_school::text, v_before,
    jsonb_build_object(
      'smsUnitPriceCents', p_sms_unit_price_cents, 'whatsappPriceCents', p_whatsapp_price_cents,
      'overdraftLimitCents', p_overdraft_limit_cents, 'senderId', nullif(p_sender_id, ''),
      'senderIdApproved', p_sender_id_approved AND nullif(p_sender_id, '') IS NOT NULL
    ),
    p_ip
  );
END
$$;

-- Arend admin: credit a wallet (bank transfer or free starter credit). Audited in the school's log.
CREATE FUNCTION app_admin_credit_wallet(
  p_school uuid, p_kind text, p_amount_cents int, p_reference text, p_note text, p_ip text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_topup uuid;
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('manual', 'starter') OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid credit' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wallets WHERE school_id = p_school) THEN
    RAISE EXCEPTION 'school not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO wallet_topups (
    school_id, method, amount_cents, status, reference, note, requested_by_id, completed_at, updated_at
  ) VALUES (
    p_school, p_kind, p_amount_cents, 'completed', nullif(p_reference, ''), nullif(p_note, ''),
    app_user_id(), now(), now()
  ) RETURNING id INTO v_topup;
  INSERT INTO wallet_entries (school_id, type, amount_cents, description, topup_id, created_by_id)
  VALUES (
    p_school,
    (CASE p_kind WHEN 'manual' THEN 'manual_topup' ELSE 'starter_credit' END)::"WalletEntryType",
    p_amount_cents,
    CASE p_kind
      WHEN 'manual' THEN 'Bank top-up' || coalesce(' ' || nullif(p_reference, ''), '')
      ELSE 'Starter credit from Arend Studio'
    END,
    v_topup, app_user_id()
  );
  UPDATE wallets SET low_balance_alerted_at = NULL, updated_at = now() WHERE school_id = p_school;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after, ip)
  VALUES (
    p_school, app_user_id(), 'wallet.credit', 'wallet_topup', v_topup::text,
    jsonb_build_object('kind', p_kind, 'amountCents', p_amount_cents,
                       'reference', nullif(p_reference, ''), 'note', nullif(p_note, '')),
    p_ip
  );
  RETURN v_topup;
END
$$;

REVOKE ALL ON FUNCTION
  kiota_create_wallet(), app_due_message_schools(timestamptz), app_message_school(text, text),
  app_wallet_topup_school(text), app_admin_wallets(),
  app_admin_set_wallet(uuid, int, int, int, text, boolean, text),
  app_admin_credit_wallet(uuid, text, int, text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_due_message_schools(timestamptz), app_message_school(text, text),
  app_wallet_topup_school(text), app_admin_wallets(),
  app_admin_set_wallet(uuid, int, int, int, text, boolean, text),
  app_admin_credit_wallet(uuid, text, int, text, text, text)
TO kiota_app;

-- ---------------------------------------------------------------------------
-- Template registry (configuration). WhatsApp templates start "not_submitted": an Arend admin
-- marks each one approved once Meta approves it (docs/messaging.md).
-- ---------------------------------------------------------------------------
INSERT INTO message_templates
  (key, language, description, category, critical, sms_body, whatsapp_name, whatsapp_body,
   whatsapp_params, whatsapp_header)
VALUES
  ('payment_received', 'en', 'Payment received, with the new balance and receipt link', 'fees', false,
   '{school}: KES {amount} received for {student} ({admission}). New balance {balance}.[[ Credit {credit}.]] Receipt {receipt_no}: {link}',
   'kiota_payment_receipt',
   '{{1}}: we received KES {{2}} for {{3}}. New balance {{4}}. Your receipt {{5}} is attached.',
   ARRAY['school','amount','student','balance','receipt_no'], 'document'),
  ('payment_received', 'sw', 'Malipo yamepokelewa, salio jipya na kiungo cha risiti', 'fees', false,
   '{school}: Tumepokea KES {amount} kwa ajili ya {student} ({admission}). Salio jipya {balance}.[[ Ziada {credit}.]] Risiti {receipt_no}: {link}',
   'kiota_payment_receipt',
   '{{1}}: tumepokea KES {{2}} kwa ajili ya {{3}}. Salio jipya {{4}}. Risiti yako {{5}} imeambatishwa.',
   ARRAY['school','amount','student','balance','receipt_no'], 'document'),
  ('fee_reminder', 'en', 'Fee reminder with the balance and due date', 'fees', false,
   '{school}: Dear parent, {student} ({admission}) has a fee balance of {balance}[[ due by {due_date}]].[[ Pay by M-Pesa Paybill {paybill}, account {admission}.]] Thank you.',
   'kiota_fee_reminder',
   '{{1}}: Dear parent, {{2}} ({{3}}) has a fee balance of {{4}}. Thank you.',
   ARRAY['school','student','admission','balance'], NULL),
  ('fee_reminder', 'sw', 'Ukumbusho wa karo, salio na tarehe ya mwisho', 'fees', false,
   '{school}: Mzazi, {student} ({admission}) ana salio la karo la {balance}[[ linalotakiwa kufikia {due_date}]].[[ Lipa kwa M-Pesa Paybill {paybill}, akaunti {admission}.]] Asante.',
   'kiota_fee_reminder',
   '{{1}}: Mzazi, {{2}} ({{3}}) ana salio la karo la {{4}}. Asante.',
   ARRAY['school','student','admission','balance'], NULL),
  ('notice', 'en', 'A notice from the school', 'general', false,
   '{school}: {message}', 'kiota_notice', '{{1}}: {{2}}', ARRAY['school','message'], NULL),
  ('notice', 'sw', 'Tangazo kutoka shuleni', 'general', false,
   '{school}: {message}', 'kiota_notice', '{{1}}: {{2}}', ARRAY['school','message'], NULL),
  ('report_card', 'en', 'Report card released, with a secure link', 'academics', false,
   '{school}: The report card of {student} for {term} is ready. Open it here: {link}',
   'kiota_report_card', '{{1}}: The report card of {{2}} for {{3}} is ready. Open it here: {{4}}',
   ARRAY['school','student','term','link'], NULL),
  ('report_card', 'sw', 'Ripoti imetolewa, na kiungo salama', 'academics', false,
   '{school}: Ripoti ya {student} ya {term} iko tayari. Ifungue hapa: {link}',
   'kiota_report_card', '{{1}}: Ripoti ya {{2}} ya {{3}} iko tayari. Ifungue hapa: {{4}}',
   ARRAY['school','student','term','link'], NULL),
  ('leaveout_alert', 'en', 'Leave-out: the child left or returned', 'boarding', true,
   '{school}: {student} {event} at {time}[[ with {collector}]].[[ Expected back {return_time}.]]',
   'kiota_leaveout_alert', '{{1}}: {{2}} {{3}} at {{4}}.', ARRAY['school','student','event','time'], NULL),
  ('leaveout_alert', 'sw', 'Ruhusa: mtoto ametoka au amerudi', 'boarding', true,
   '{school}: {student} {event} saa {time}[[ pamoja na {collector}]].[[ Anatarajiwa kurudi {return_time}.]]',
   'kiota_leaveout_alert', '{{1}}: {{2}} {{3}} saa {{4}}.', ARRAY['school','student','event','time'], NULL);
