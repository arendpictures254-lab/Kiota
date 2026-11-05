-- AlterTable
ALTER TABLE "guardian_links" ADD COLUMN     "portal_first_seen_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "mpesa_transactions" ADD COLUMN     "portal_user_id" UUID;

-- AlterTable
ALTER TABLE "parent_link_confirmations" ADD COLUMN     "declined_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "modules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3),
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferred_language" "Language" NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "notice_reads" (
    "school_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_reads_pkey" PRIMARY KEY ("campaign_id","user_id")
);

-- CreateIndex
CREATE INDEX "notice_reads_school_id_campaign_id_idx" ON "notice_reads"("school_id", "campaign_id");

ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "message_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mpesa_transactions" ADD CONSTRAINT "mpesa_transactions_portal_user_id_fkey"
  FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "schools" SET "modules" = '{}' WHERE "modules" IS NULL;
ALTER TABLE "schools" ALTER COLUMN "modules" SET NOT NULL;

-- ===========================================================================
-- Parent portal. Parents are platform users with no membership in any school, so they never
-- get a school context: everything they see comes through the functions below, each of which
-- starts from the caller's own guardian link (app_user_id()). A link waiting for the parent to
-- confirm, or declined, shows nothing but the school's name and the child's first name.
-- ===========================================================================

-- Read counts per notice: the school reads its own rows; parents write through a function.
ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE notice_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY notice_reads_school ON notice_reads FOR SELECT
  USING (school_id = (SELECT app_current_school()));
GRANT SELECT ON notice_reads TO kiota_app;

-- Sign-in: staff, Arend admins, and parents with at least one link they have not declined.
CREATE OR REPLACE FUNCTION app_phone_can_sign_in(p_phone text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_phone LIKE 'system:%' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM users u
    WHERE u.phone = p_phone
      AND (
        u.is_platform_admin
        OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.status = 'active')
        OR EXISTS (
          SELECT 1 FROM guardian_links g
          JOIN students s ON s.id = g.student_id AND s.status = 'active'
          JOIN schools sc ON sc.id = g.school_id AND sc.status <> 'suspended'
          LEFT JOIN parent_link_confirmations c ON c.guardian_link_id = g.id
          WHERE g.user_id = u.id AND (c.status IS NULL OR c.status <> 'declined')
        )
      )
  );
END
$$;

-- The caller's own record, now with their language.
DROP FUNCTION app_me();
CREATE FUNCTION app_me()
RETURNS TABLE (id uuid, name text, phone text, is_platform_admin boolean, preferred_language text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.name, u.phone, u.is_platform_admin, u.preferred_language::text
  FROM users u WHERE u.id = app_user_id();
END
$$;

-- The caller's language for Kiota, and for every school's messages to them.
CREATE FUNCTION app_set_my_language(p_language text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF app_user_id() IS NULL OR p_language NOT IN ('en', 'sw') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET preferred_language = p_language::"Language", updated_at = now()
  WHERE id = app_user_id();
  UPDATE guardian_links SET language = p_language::"Language", updated_at = now()
  WHERE user_id = app_user_id() AND language <> p_language::"Language";
END
$$;

-- One of the caller's links that is live (not waiting for confirmation, not declined), or NULL.
-- Internal: used by the functions below, never granted to the app.
CREATE FUNCTION kiota_parent_link(p_link uuid) RETURNS guardian_links
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  SELECT g.* INTO v
  FROM guardian_links g
  JOIN students s ON s.id = g.student_id AND s.status = 'active'
  JOIN schools sc ON sc.id = g.school_id AND sc.status <> 'suspended'
  WHERE g.id = p_link
    AND g.user_id = app_user_id()
    AND NOT EXISTS (
      SELECT 1 FROM parent_link_confirmations c
      WHERE c.guardian_link_id = g.id AND c.status <> 'confirmed'
    );
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION kiota_parent_link(uuid) FROM PUBLIC;

-- The caller's children, in every school. A pending link: school name and first name only.
CREATE FUNCTION app_my_children()
RETURNS TABLE (
  link_id uuid, pending boolean, school_id uuid, school_name text, school_modules text[],
  student_id uuid, first_name text, last_name text, admission_number text, class_name text,
  stream_name text, has_photo boolean, relationship text, receives_fees boolean,
  receives_academics boolean, receives_boarding boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.id,
    p.pending,
    CASE WHEN p.pending THEN NULL ELSE sc.id END,
    sc.name,
    CASE WHEN p.pending THEN '{}'::text[] ELSE sc.modules END,
    CASE WHEN p.pending THEN NULL ELSE s.id END,
    s.first_name,
    CASE WHEN p.pending THEN NULL ELSE s.last_name END,
    CASE WHEN p.pending THEN NULL ELSE s.admission_number END,
    CASE WHEN p.pending THEN NULL ELSE cl.name END,
    CASE WHEN p.pending THEN NULL ELSE st.name END,
    CASE WHEN p.pending THEN false ELSE s.photo_key IS NOT NULL END,
    g.relationship::text,
    g.receives_fees,
    g.receives_academics,
    g.receives_boarding
  FROM guardian_links g
  JOIN students s ON s.id = g.student_id AND s.status = 'active'
  JOIN schools sc ON sc.id = g.school_id AND sc.status <> 'suspended'
  JOIN classes cl ON cl.id = s.class_id
  LEFT JOIN streams st ON st.id = s.stream_id
  LEFT JOIN parent_link_confirmations c ON c.guardian_link_id = g.id
  CROSS JOIN LATERAL (SELECT COALESCE(c.status = 'pending', false) AS pending) p
  WHERE g.user_id = app_user_id() AND (c.status IS NULL OR c.status <> 'declined')
  ORDER BY p.pending DESC, s.first_name, sc.name;
END
$$;

-- A child's fees, if the link may see fees: balance, by vote head, invoices with due dates,
-- payments with their receipts, and whether the school takes M-Pesa through Kiota.
CREATE FUNCTION app_parent_fees(p_link uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
  r jsonb;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL OR NOT v.receives_fees THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'balanceCents', COALESCE((
      SELECT sum(l.amount_cents) FROM ledger_lines l
      WHERE l.school_id = v.school_id AND l.student_id = v.student_id), 0),
    'voteHeads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', vh.name, 'balanceCents', t.total)
                       ORDER BY vh.priority NULLS LAST, vh.name)
      FROM (
        SELECT l.vote_head_id, sum(l.amount_cents) AS total FROM ledger_lines l
        WHERE l.school_id = v.school_id AND l.student_id = v.student_id
        GROUP BY l.vote_head_id
      ) t
      LEFT JOIN vote_heads vh ON vh.id = t.vote_head_id
      WHERE t.total <> 0), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'term', tm.name, 'year', ay.name, 'totalCents', i.total_cents,
        'createdAt', i.created_at,
        'installments', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('dueDate', fi.due_date, 'percentBp', fi.percent_bp)
                           ORDER BY fi.due_date)
          FROM fee_installments fi
          WHERE fi.school_id = v.school_id AND fi.fee_structure_id = i.fee_structure_id
        ), '[]'::jsonb)) ORDER BY i.created_at DESC)
      FROM invoices i
      JOIN terms tm ON tm.id = i.term_id
      JOIN academic_years ay ON ay.id = tm.academic_year_id
      WHERE i.school_id = v.school_id AND i.student_id = v.student_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'amountCents', p.amount_cents, 'method', p.method::text,
        'reference', p.reference, 'paidAt', p.paid_at, 'receiptNumber', rc.number,
        'shareToken', rc.share_token, 'reversed', rv.id IS NOT NULL)
        ORDER BY p.paid_at DESC, p.created_at DESC)
      FROM payments p
      LEFT JOIN receipts rc ON rc.payment_id = p.id
      LEFT JOIN reversals rv ON rv.payment_id = p.id
      WHERE p.school_id = v.school_id AND p.student_id = v.student_id), '[]'::jsonb),
    'mpesa', EXISTS (SELECT 1 FROM mpesa_settings ms WHERE ms.school_id = v.school_id)
  ) INTO r;
  RETURN r;
END
$$;

-- The storage key of a child's photo (the portal serves it after this check).
CREATE FUNCTION app_parent_child_photo(p_link uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
  k text;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.photo_key INTO k FROM students s WHERE s.id = v.student_id AND s.school_id = v.school_id;
  RETURN k;
END
$$;

-- Notices from the child's school that were sent to this parent (any of their links there),
-- newest first, in the link's language when the school wrote a Kiswahili version.
CREATE FUNCTION app_parent_notices(p_link uuid)
RETURNS TABLE (campaign_id uuid, body text, critical boolean, created_at timestamptz, read_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id,
         CASE WHEN v.language = 'sw' AND c.body_sw IS NOT NULL THEN c.body_sw ELSE c.body END,
         c.critical, c.created_at::timestamptz, nr.read_at::timestamptz
  FROM message_campaigns c
  LEFT JOIN notice_reads nr ON nr.campaign_id = c.id AND nr.user_id = v.user_id
  WHERE c.school_id = v.school_id
    AND c.kind = 'notice'
    AND EXISTS (
      SELECT 1 FROM messages m
      JOIN guardian_links g2 ON g2.id = m.guardian_link_id
      WHERE m.school_id = v.school_id AND m.campaign_id = c.id AND g2.user_id = v.user_id
    )
  ORDER BY c.created_at DESC
  LIMIT 100;
END
$$;

-- Mark a notice read (only one that was sent to the caller, through a live link).
CREATE FUNCTION app_parent_mark_read(p_campaign uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO notice_reads (school_id, campaign_id, user_id)
  SELECT c.school_id, c.id, app_user_id()
  FROM message_campaigns c
  WHERE c.id = p_campaign
    AND c.kind = 'notice'
    AND EXISTS (
      SELECT 1 FROM messages m
      JOIN guardian_links g ON g.id = m.guardian_link_id
      WHERE m.school_id = c.school_id AND m.campaign_id = c.id AND g.user_id = app_user_id()
        AND (kiota_parent_link(g.id)).id IS NOT NULL
    )
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END
$$;

-- The parent confirms a link from a second school (the app checks a fresh SMS code first).
CREATE FUNCTION app_confirm_parent_link(p_link uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE parent_link_confirmations SET status = 'confirmed', confirmed_at = now()
  WHERE guardian_link_id = p_link AND user_id = app_user_id() AND status = 'pending';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE guardian_links SET portal_first_seen_at = COALESCE(portal_first_seen_at, now())
  WHERE id = p_link;
  RETURN true;
END
$$;

-- The parent declines: that school's Directors are told, in the school's own words, with
-- nothing about any other school.
CREATE FUNCTION app_decline_parent_link(p_link uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE parent_link_confirmations SET status = 'declined', declined_at = now()
  WHERE guardian_link_id = p_link AND user_id = app_user_id() AND status = 'pending';
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO notifications (school_id, membership_id, title, body, link)
  SELECT g.school_id, m.id,
         'A parent declined the portal link',
         format('%s chose not to add %s %s to their Kiota parent account. Messages from the school still reach this number.',
                g.name, s.first_name, s.last_name),
         '/dashboard/students/' || s.id
  FROM guardian_links g
  JOIN students s ON s.id = g.student_id
  JOIN memberships m ON m.school_id = g.school_id AND m.status = 'active'
  WHERE g.id = p_link
    AND EXISTS (
      SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
      WHERE mr.membership_id = m.id AND r.key = 'director'
    );
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after)
  SELECT g.school_id, app_user_id(), 'guardian.portal_decline', 'guardian_link', g.id::text,
         jsonb_build_object('studentId', g.student_id)
  FROM guardian_links g WHERE g.id = p_link;
  RETURN true;
END
$$;

-- At sign-in: the schools see that this parent has signed in (only links they can see).
CREATE FUNCTION app_record_parent_sign_in() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE guardian_links g SET portal_first_seen_at = now()
  WHERE g.user_id = app_user_id()
    AND g.portal_first_seen_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM parent_link_confirmations c
      WHERE c.guardian_link_id = g.id AND c.status <> 'confirmed'
    );
END
$$;

-- The outcome of an M-Pesa prompt the caller started from the portal, with the receipt once
-- posted (also when the Paybill's own confirmation posted it first: status "merged").
CREATE FUNCTION app_parent_stk_status(p_txn uuid)
RETURNS TABLE (status text, status_detail text, amount_cents integer, receipt_number integer, share_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.status, t.status_detail, t.amount_cents, rc.number, rc.share_token
  FROM mpesa_transactions t
  LEFT JOIN mpesa_transactions posted
    ON posted.school_id = t.school_id
   AND posted.payment_id IS NOT NULL
   AND (posted.id = t.id OR (t.status = 'merged' AND posted.trans_id = t.trans_id))
  LEFT JOIN receipts rc ON rc.payment_id = posted.payment_id
  WHERE t.id = p_txn AND t.portal_user_id = app_user_id()
  ORDER BY rc.number NULLS LAST
  LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION app_me(), app_set_my_language(text), app_my_children(),
  app_parent_fees(uuid), app_parent_child_photo(uuid), app_parent_notices(uuid),
  app_parent_mark_read(uuid), app_confirm_parent_link(uuid), app_decline_parent_link(uuid),
  app_record_parent_sign_in(), app_parent_stk_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_me(), app_set_my_language(text), app_my_children(),
  app_parent_fees(uuid), app_parent_child_photo(uuid), app_parent_notices(uuid),
  app_parent_mark_read(uuid), app_confirm_parent_link(uuid), app_decline_parent_link(uuid),
  app_record_parent_sign_in(), app_parent_stk_status(uuid) TO kiota_app;

-- The invitation to the parent portal (configuration, like every template).
INSERT INTO message_templates
  (key, language, description, category, critical, sms_body, whatsapp_name, whatsapp_body,
   whatsapp_params, whatsapp_header)
VALUES
  ('parent_invite', 'en', 'Invitation to the parent portal', 'account', false,
   '{school} now uses Kiota. Sign in at {link} with this phone number to see fees and receipts.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('parent_invite', 'sw', 'Mwaliko wa kuingia kwenye Kiota', 'account', false,
   '{school} sasa inatumia Kiota. Ingia kwenye {link} kwa nambari hii ya simu uone karo na risiti.',
   NULL, NULL, ARRAY[]::text[], NULL);

-- Arend admin switches optional modules on for a school (the portal shows their sections).
CREATE FUNCTION app_admin_set_school_modules(p_school uuid, p_modules text[], p_ip text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_before text[];
  v_clean text[];
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT m ORDER BY m), '{}') INTO v_clean
  FROM unnest(p_modules) m WHERE m IN ('academics', 'boarding', 'pocket_money');
  SELECT modules INTO v_before FROM schools WHERE id = p_school FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'school not found' USING ERRCODE = '22023';
  END IF;
  UPDATE schools SET modules = v_clean, updated_at = now() WHERE id = p_school;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, before, after, ip)
  VALUES (p_school, app_user_id(), 'school.modules', 'school', p_school::text,
          jsonb_build_object('modules', v_before), jsonb_build_object('modules', v_clean), p_ip);
END
$$;
REVOKE ALL ON FUNCTION app_admin_set_school_modules(uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_admin_set_school_modules(uuid, text[], text) TO kiota_app;
