-- CreateEnum
CREATE TYPE "FeeAppliesTo" AS ENUM ('boarder', 'day');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('invoice', 'charge', 'payment', 'discount', 'bursary', 'opening_balance', 'reversal', 'credit_applied');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('mpesa', 'cash', 'bank', 'cheque');

-- CreateTable
CREATE TABLE "vote_heads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "is_arrears" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "vote_head_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "applies_to" "FeeAppliesTo" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "fee_item_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "fee_structure_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "percent_bp" INTEGER NOT NULL,

    CONSTRAINT "fee_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sibling_position" INTEGER NOT NULL,
    "percent_bp" INTEGER NOT NULL,
    "vote_head_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bursaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "term_id" UUID,
    "kind" TEXT NOT NULL,
    "sponsor_name" TEXT NOT NULL,
    "coverage" TEXT NOT NULL,
    "percent_bp" INTEGER,
    "amount_cents" INTEGER,
    "vote_head_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bursaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "fee_structure_id" UUID NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "term_id" UUID,
    "description" TEXT NOT NULL,
    "invoice_id" UUID,
    "payment_id" UUID,
    "reverses_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "vote_head_id" UUID,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reference" TEXT,
    "payer_name" TEXT,
    "payer_phone" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "mpesa_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "share_token" TEXT NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_counters" (
    "school_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "reversals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "ledger_entry_id" UUID NOT NULL,
    "reversed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reversals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pledges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "made_by" TEXT NOT NULL,
    "note" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pledges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_settings" (
    "school_id" UUID NOT NULL,
    "shortcode" TEXT NOT NULL,
    "shortcode_type" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "consumer_key_enc" TEXT,
    "consumer_secret_enc" TEXT,
    "passkey_enc" TEXT,
    "initiator_name" TEXT,
    "security_credential_enc" TEXT,
    "callback_token_enc" TEXT NOT NULL,
    "callback_token_hash" TEXT NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mpesa_settings_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "mpesa_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "trans_id" TEXT,
    "checkout_request_id" TEXT,
    "amount_cents" INTEGER,
    "msisdn" TEXT,
    "bill_ref" TEXT,
    "payer_name" TEXT,
    "trans_time" TIMESTAMPTZ(3),
    "student_id" UUID,
    "requested_by_id" UUID,
    "status" TEXT NOT NULL,
    "status_detail" TEXT,
    "payment_id" UUID,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mpesa_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vote_heads_school_id_name_key" ON "vote_heads"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vote_heads_school_id_id_key" ON "vote_heads"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_school_id_name_key" ON "fee_items"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_school_id_id_key" ON "fee_items"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_term_id_level_id_applies_to_key" ON "fee_structures"("term_id", "level_id", "applies_to");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_school_id_id_key" ON "fee_structures"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_lines_fee_structure_id_fee_item_id_key" ON "fee_structure_lines"("fee_structure_id", "fee_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_rules_school_id_name_key" ON "discount_rules"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_student_id_term_id_key" ON "invoices"("student_id", "term_id");

-- CreateIndex
CREATE INDEX "ledger_entries_student_id_created_at_idx" ON "ledger_entries"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_school_id_type_created_at_idx" ON "ledger_entries"("school_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_school_id_id_key" ON "ledger_entries"("school_id", "id");

-- CreateIndex
CREATE INDEX "ledger_lines_student_id_vote_head_id_idx" ON "ledger_lines"("student_id", "vote_head_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mpesa_transaction_id_key" ON "payments"("mpesa_transaction_id");

-- CreateIndex
CREATE INDEX "payments_school_id_paid_at_idx" ON "payments"("school_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_method_reference_key" ON "payments"("school_id", "method", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_id_key" ON "payments"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_share_token_key" ON "receipts"("share_token");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_school_id_number_key" ON "receipts"("school_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_school_id_payment_id_key" ON "receipts"("school_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversals_payment_id_key" ON "reversals"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reversals_school_id_payment_id_key" ON "reversals"("school_id", "payment_id");

-- CreateIndex
CREATE INDEX "notifications_membership_id_read_at_idx" ON "notifications"("membership_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_settings_callback_token_hash_key" ON "mpesa_settings"("callback_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_checkout_request_id_key" ON "mpesa_transactions"("checkout_request_id");

-- CreateIndex
CREATE INDEX "mpesa_transactions_school_id_status_idx" ON "mpesa_transactions"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_transactions_school_id_trans_id_key" ON "mpesa_transactions"("school_id", "trans_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_school_id_id_key" ON "terms"("school_id", "id");

-- AddForeignKey
ALTER TABLE "vote_heads" ADD CONSTRAINT "vote_heads_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_school_id_vote_head_id_fkey" FOREIGN KEY ("school_id", "vote_head_id") REFERENCES "vote_heads"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_term_id_fkey" FOREIGN KEY ("school_id", "term_id") REFERENCES "terms"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_level_id_fkey" FOREIGN KEY ("school_id", "level_id") REFERENCES "levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_school_id_fee_structure_id_fkey" FOREIGN KEY ("school_id", "fee_structure_id") REFERENCES "fee_structures"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_lines" ADD CONSTRAINT "fee_structure_lines_school_id_fee_item_id_fkey" FOREIGN KEY ("school_id", "fee_item_id") REFERENCES "fee_items"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_school_id_fee_structure_id_fkey" FOREIGN KEY ("school_id", "fee_structure_id") REFERENCES "fee_structures"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_school_id_vote_head_id_fkey" FOREIGN KEY ("school_id", "vote_head_id") REFERENCES "vote_heads"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_school_id_entry_id_fkey" FOREIGN KEY ("school_id", "entry_id") REFERENCES "ledger_entries"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_school_id_payment_id_fkey" FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversals" ADD CONSTRAINT "reversals_school_id_payment_id_fkey" FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: grants, row-level security, append-only money records
-- ===========================================================================

-- Configuration: full access within the school (the app checks fees.setup).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  vote_heads, fee_items, fee_structures, fee_structure_lines, fee_installments, discount_rules
TO kiota_app;
GRANT SELECT, INSERT, UPDATE ON bursaries, pledges, notifications, mpesa_settings,
  mpesa_transactions, receipt_counters
TO kiota_app;
-- Money records: append-only. No UPDATE, no DELETE, and a trigger that also stops the owner.
GRANT SELECT, INSERT ON invoices, ledger_entries, ledger_lines, payments, receipts, reversals
TO kiota_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vote_heads','fee_items','fee_structures','fee_structure_lines','fee_installments',
    'discount_rules','bursaries','invoices','ledger_entries','ledger_lines','payments','receipts',
    'receipt_counters','reversals','pledges','notifications','mpesa_settings','mpesa_transactions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- School wall.
  FOREACH t IN ARRAY ARRAY[
    'vote_heads','fee_items','fee_structures','fee_structure_lines','fee_installments',
    'discount_rules','receipt_counters','mpesa_transactions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (school_id = (SELECT app_current_school())) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;

  -- About one student: visible only when the student is visible.
  FOREACH t IN ARRAY ARRAY['bursaries','invoices','ledger_entries','ledger_lines','payments','pledges']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING (school_id = (SELECT app_current_school()) '
      '       AND EXISTS (SELECT 1 FROM students s WHERE s.id = student_id)) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;

  -- About one payment: follows the payment.
  FOREACH t IN ARRAY ARRAY['receipts','reversals'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING (school_id = (SELECT app_current_school()) '
      '       AND EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id)) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['invoices','ledger_entries','ledger_lines','payments','receipts','reversals']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kiota_append_only()',
      t || '_append_only', t);
  END LOOP;
END
$$;

-- Notifications: each person reads and marks only their own.
CREATE POLICY notifications_own ON notifications FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND membership_id IN (SELECT m.id FROM memberships m WHERE m.user_id = (SELECT app_user_id()))
  );
CREATE POLICY notifications_mark ON notifications FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND membership_id IN (SELECT m.id FROM memberships m WHERE m.user_id = (SELECT app_user_id()))
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
CREATE POLICY notifications_create ON notifications FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()));

-- M-Pesa credentials: only people who set up or collect fees (and the automatic payments role).
CREATE POLICY mpesa_settings_school ON mpesa_settings FOR ALL
  USING (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('fees.setup')) OR (SELECT app_has_permission('fees.collect')))
  )
  WITH CHECK (
    school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('fees.setup'))
  );

-- ---------------------------------------------------------------------------
-- Narrow privileged functions
-- ---------------------------------------------------------------------------

-- M-Pesa callbacks arrive without a signed-in user. The secret token in the callback URL
-- (hashed) identifies the school; nothing else is returned.
CREATE FUNCTION app_mpesa_school_for_token(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v uuid;
BEGIN
  SELECT school_id INTO v FROM mpesa_settings WHERE callback_token_hash = p_token_hash;
  RETURN v;
END
$$;

-- Public receipt behind an unguessable share link. Returns only what is printed on the receipt;
-- the student's last name is shortened to an initial.
CREATE FUNCTION app_receipt_public(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'number', r.number,
    'issuedAt', r.issued_at,
    'balanceAfterCents', r.balance_after_cents,
    'amountCents', p.amount_cents,
    'method', p.method,
    'reference', p.reference,
    'paidAt', p.paid_at,
    'studentName', s.first_name || ' ' || left(s.last_name, 1) || '.',
    'admissionNumber', s.admission_number,
    'className', c.name || coalesce(' ' || st.name, ''),
    'schoolName', sc.name,
    'schoolShortName', sc.short_name,
    'schoolLogoKey', sc.logo_url,
    'schoolId', sc.id,
    'reversed', EXISTS (SELECT 1 FROM reversals rv WHERE rv.payment_id = p.id)
  ) INTO v
  FROM receipts r
  JOIN payments p ON p.id = r.payment_id
  JOIN students s ON s.id = p.student_id
  JOIN classes c ON c.id = s.class_id
  LEFT JOIN streams st ON st.id = s.stream_id
  JOIN schools sc ON sc.id = r.school_id
  WHERE r.share_token = p_token;
  RETURN v;
END
$$;

REVOKE ALL ON FUNCTION app_mpesa_school_for_token(text), app_receipt_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_mpesa_school_for_token(text), app_receipt_public(text) TO kiota_app;
