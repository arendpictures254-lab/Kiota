-- CreateTable
CREATE TABLE "leaveouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reason_id" UUID,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "leave_at" TIMESTAMPTZ(3) NOT NULL,
    "return_at" TIMESTAMPTZ(3) NOT NULL,
    "collector_kind" TEXT NOT NULL,
    "collector_link_id" UUID,
    "collector_name" TEXT NOT NULL,
    "collector_phone" TEXT NOT NULL,
    "collector_relationship" TEXT NOT NULL,
    "collector_confirm_code" TEXT,
    "collector_approved_at" TIMESTAMPTZ(3),
    "collector_approved_by_id" UUID,
    "status" TEXT NOT NULL,
    "requested_via" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "pass_token" TEXT,
    "pickup_code_hash" TEXT,
    "student_name" TEXT NOT NULL,
    "admission_number" TEXT NOT NULL,
    "class_label" TEXT NOT NULL,
    "photo_key" TEXT,
    "exited_at" TIMESTAMPTZ(3),
    "exit_by_id" UUID,
    "returned_at" TIMESTAMPTZ(3),
    "return_by_id" UUID,
    "overdue_alerted_at" TIMESTAMPTZ(3),
    "batch_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leaveouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaveout_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "leaveout_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_id" UUID NOT NULL,
    "device_event_id" TEXT NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "conflict" TEXT,

    CONSTRAINT "leaveout_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaveout_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leaveout_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaveout_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "created" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaveout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaveout_pass_keys" (
    "school_id" UUID NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key_enc" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaveout_pass_keys_pkey" PRIMARY KEY ("school_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leaveouts_pass_token_key" ON "leaveouts"("pass_token");

-- CreateIndex
CREATE INDEX "leaveouts_school_id_status_idx" ON "leaveouts"("school_id", "status");

-- CreateIndex
CREATE INDEX "leaveouts_school_id_student_id_idx" ON "leaveouts"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "leaveouts_school_id_leave_at_idx" ON "leaveouts"("school_id", "leave_at");

-- CreateIndex
CREATE UNIQUE INDEX "leaveouts_school_id_id_key" ON "leaveouts"("school_id", "id");

-- CreateIndex
CREATE INDEX "leaveout_events_school_id_leaveout_id_idx" ON "leaveout_events"("school_id", "leaveout_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaveout_events_school_id_device_event_id_key" ON "leaveout_events"("school_id", "device_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaveout_reasons_school_id_name_key" ON "leaveout_reasons"("school_id", "name");

-- CreateIndex
CREATE INDEX "leaveout_batches_school_id_created_at_idx" ON "leaveout_batches"("school_id", "created_at");

-- AddForeignKey
ALTER TABLE "leaveouts" ADD CONSTRAINT "leaveouts_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaveout_events" ADD CONSTRAINT "leaveout_events_leaveout_id_fkey" FOREIGN KEY ("leaveout_id") REFERENCES "leaveouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Leave-outs (exeat). Every table is walled per school with row-level security.
--  - Requesters (leaveout.request) see leave-outs of students they can see; approvers
--    (leaveout.approve, granted person by person), boarding staff (boarding.manage) and the
--    gate (gate.scan) see all of the school's. The gate reads only the copy of the student's
--    name, class, admission number and photo on the leave-out: never student records.
--  - Gate events are append-only.
--  - Parents act only through the app_parent_* functions below, from their own link.
-- ===========================================================================

ALTER TABLE leaveouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaveouts FORCE ROW LEVEL SECURITY;
CREATE POLICY leaveouts_select ON leaveouts FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('leaveout.approve'))
      OR (SELECT app_has_permission('boarding.manage'))
      OR (SELECT app_has_permission('gate.scan'))
      OR (
        (SELECT app_has_permission('leaveout.request'))
        AND EXISTS (SELECT 1 FROM students s WHERE s.id = leaveouts.student_id)
      )
    )
  );
CREATE POLICY leaveouts_insert ON leaveouts FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('leaveout.request')) OR (SELECT app_has_permission('leaveout.approve')))
  );
CREATE POLICY leaveouts_update ON leaveouts FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('leaveout.approve'))
      OR (SELECT app_has_permission('boarding.manage'))
      OR (SELECT app_has_permission('gate.scan'))
      OR (
        (SELECT app_has_permission('leaveout.request'))
        AND EXISTS (SELECT 1 FROM students s WHERE s.id = leaveouts.student_id)
      )
    )
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON leaveouts TO kiota_app;

ALTER TABLE leaveout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaveout_events FORCE ROW LEVEL SECURITY;
CREATE POLICY leaveout_events_select ON leaveout_events FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('leaveout.approve'))
      OR (SELECT app_has_permission('boarding.manage'))
      OR (SELECT app_has_permission('gate.scan'))
    )
  );
CREATE POLICY leaveout_events_insert ON leaveout_events FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('gate.scan')) OR (SELECT app_has_permission('boarding.manage')))
  );
GRANT SELECT, INSERT ON leaveout_events TO kiota_app;
CREATE TRIGGER leaveout_events_append_only BEFORE UPDATE OR DELETE ON leaveout_events
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();

ALTER TABLE leaveout_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaveout_reasons FORCE ROW LEVEL SECURITY;
CREATE POLICY leaveout_reasons_select ON leaveout_reasons FOR SELECT
  USING (school_id = (SELECT app_current_school()));
CREATE POLICY leaveout_reasons_write ON leaveout_reasons FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('boarding.manage')));
CREATE POLICY leaveout_reasons_update ON leaveout_reasons FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('boarding.manage')))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON leaveout_reasons TO kiota_app;

ALTER TABLE leaveout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaveout_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY leaveout_batches_all ON leaveout_batches FOR ALL
  USING (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('leaveout.approve')) OR (SELECT app_has_permission('boarding.manage')))
  )
  WITH CHECK (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('leaveout.approve')));
GRANT SELECT, INSERT ON leaveout_batches TO kiota_app;

-- The signing key: approvers sign passes; the gate reads the public key. The private key is
-- encrypted with CREDENTIALS_ENCRYPTION_KEY, which never leaves the server.
ALTER TABLE leaveout_pass_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaveout_pass_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY leaveout_pass_keys_select ON leaveout_pass_keys FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('leaveout.approve'))
      OR (SELECT app_has_permission('gate.scan'))
      OR (SELECT app_has_permission('boarding.manage'))
    )
  );
CREATE POLICY leaveout_pass_keys_insert ON leaveout_pass_keys FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('leaveout.approve')));
GRANT SELECT, INSERT ON leaveout_pass_keys TO kiota_app;

-- Default reasons, copied to every school (configuration, the school can change them).
CREATE FUNCTION kiota_copy_leaveout_reasons() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO leaveout_reasons (school_id, name, position)
  SELECT NEW.id, r.name, r.position
  FROM (VALUES ('Half term', 1), ('Weekend', 2), ('Medical appointment', 3),
               ('Family event', 4), ('Bereavement', 5), ('Other', 6)) AS r(name, position)
  ON CONFLICT (school_id, name) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER schools_copy_leaveout_reasons AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION kiota_copy_leaveout_reasons();
INSERT INTO leaveout_reasons (school_id, name, position)
SELECT s.id, r.name, r.position
FROM schools s
CROSS JOIN (VALUES ('Half term', 1), ('Weekend', 2), ('Medical appointment', 3),
                   ('Family event', 4), ('Bereavement', 5), ('Other', 6)) AS r(name, position)
ON CONFLICT (school_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Parents (through their own guardian link; the school must have boarding switched on)
-- ---------------------------------------------------------------------------

-- A live link of the caller that receives boarding messages, at a school with boarding on.
CREATE FUNCTION kiota_parent_boarding_link(p_link uuid) RETURNS guardian_links
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL OR NOT v.receives_boarding
     OR NOT EXISTS (SELECT 1 FROM schools sc WHERE sc.id = v.school_id AND 'boarding' = ANY (sc.modules)) THEN
    RETURN NULL;
  END IF;
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION kiota_parent_boarding_link(uuid) FROM PUBLIC;

-- The child's leave-outs, newest first, with the pass once approved.
CREATE FUNCTION app_parent_leaveouts(p_link uuid)
RETURNS TABLE (
  id uuid, status text, reason text, details text, leave_at timestamptz, return_at timestamptz,
  collector_name text, collector_relationship text, collector_kind text, pass_token text,
  exited_at timestamptz, returned_at timestamptz, decline_reason text, requested_via text,
  student_name text, admission_number text, class_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_boarding_link(p_link);
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT l.id, l.status, l.reason, l.details, l.leave_at::timestamptz, l.return_at::timestamptz,
         l.collector_name, l.collector_relationship, l.collector_kind,
         CASE WHEN l.status IN ('approved', 'out') THEN l.pass_token END,
         l.exited_at::timestamptz, l.returned_at::timestamptz, l.decline_reason, l.requested_via,
         l.student_name, l.admission_number, l.class_label
  FROM leaveouts l
  WHERE l.school_id = v.school_id AND l.student_id = v.student_id
  ORDER BY l.leave_at DESC
  LIMIT 50;
END
$$;

-- Who may collect this child: guardians the school marked "authorised to collect".
CREATE FUNCTION app_parent_collectors(p_link uuid)
RETURNS TABLE (link_id uuid, name text, relationship text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_boarding_link(p_link);
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT g.id, g.name, g.relationship::text FROM guardian_links g
  WHERE g.school_id = v.school_id AND g.student_id = v.student_id AND g.authorised_to_collect
  ORDER BY (g.user_id = v.user_id) DESC, g.created_at;
END
$$;

CREATE FUNCTION app_leaveout_reasons_for_parent(p_link uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_boarding_link(p_link);
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT r.id, r.name FROM leaveout_reasons r
  WHERE r.school_id = v.school_id AND r.active ORDER BY r.position, r.name;
END
$$;

-- A parent asks for a leave-out ("I will collect Amani on Friday at 2pm"). Naming someone who is
-- not an authorised guardian counts as the parent's approval of that person.
CREATE FUNCTION app_parent_request_leaveout(
  p_link uuid, p_reason uuid, p_details text, p_leave timestamptz, p_return timestamptz,
  p_collector_link uuid, p_other_name text, p_other_phone text, p_other_relationship text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
  v_reason text;
  c record;
  s record;
  v_id uuid;
BEGIN
  v := kiota_parent_boarding_link(p_link);
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_return <= p_leave OR p_leave < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'bad dates' USING ERRCODE = '22023';
  END IF;
  SELECT r.name INTO v_reason FROM leaveout_reasons r
  WHERE r.id = p_reason AND r.school_id = v.school_id AND r.active;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'bad reason' USING ERRCODE = '22023';
  END IF;
  IF p_collector_link IS NOT NULL THEN
    SELECT g.name, u.phone, g.relationship::text AS relationship INTO c
    FROM guardian_links g JOIN users u ON u.id = g.user_id
    WHERE g.id = p_collector_link AND g.school_id = v.school_id AND g.student_id = v.student_id
      AND g.authorised_to_collect;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'collector not authorised' USING ERRCODE = '22023';
    END IF;
  ELSIF coalesce(trim(p_other_name), '') = '' OR coalesce(p_other_phone, '') !~ '^\+254\d{9}$'
        OR coalesce(trim(p_other_relationship), '') = '' THEN
    RAISE EXCEPTION 'bad collector' USING ERRCODE = '22023';
  END IF;
  SELECT st.first_name || ' ' || st.last_name AS name, st.admission_number,
         cl.name || coalesce(' ' || sm.name, '') AS class_label, st.photo_key
  INTO s
  FROM students st JOIN classes cl ON cl.id = st.class_id LEFT JOIN streams sm ON sm.id = st.stream_id
  WHERE st.id = v.student_id;

  INSERT INTO leaveouts (
    school_id, student_id, reason_id, reason, details, leave_at, return_at, collector_kind,
    collector_link_id, collector_name, collector_phone, collector_relationship,
    collector_approved_at, collector_approved_by_id, status, requested_via, requested_by_id,
    student_name, admission_number, class_label, photo_key, updated_at
  ) VALUES (
    v.school_id, v.student_id, p_reason, v_reason, nullif(trim(p_details), ''), p_leave, p_return,
    CASE WHEN p_collector_link IS NULL THEN 'other' ELSE 'guardian' END,
    p_collector_link,
    coalesce(c.name, trim(p_other_name)), coalesce(c.phone, p_other_phone),
    coalesce(c.relationship, trim(p_other_relationship)),
    CASE WHEN p_collector_link IS NULL THEN now() END,
    CASE WHEN p_collector_link IS NULL THEN v.user_id END,
    'pending', 'parent', v.user_id, s.name, s.admission_number, s.class_label, s.photo_key, now()
  ) RETURNING id INTO v_id;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after)
  VALUES (v.school_id, v.user_id, 'leaveout.request', 'leaveout', v_id::text,
          jsonb_build_object('studentId', v.student_id, 'via', 'parent', 'leaveAt', p_leave,
                             'returnAt', p_return, 'collector', coalesce(c.name, trim(p_other_name))));
  RETURN v_id;
END
$$;

-- The parent approves (or refuses) a collector a staff member named who is not an authorised
-- guardian. Any of the child's guardians who receive boarding messages may answer.
CREATE FUNCTION kiota_answer_collector(p_leaveout uuid, p_user uuid, p_yes boolean, p_via text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l leaveouts;
BEGIN
  SELECT * INTO l FROM leaveouts WHERE id = p_leaveout AND status = 'awaiting_parent' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM guardian_links g
    WHERE g.student_id = l.student_id AND g.school_id = l.school_id AND g.user_id = p_user
      AND g.receives_boarding AND (kiota_parent_link_for(g.id, p_user)).id IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;
  IF p_yes THEN
    UPDATE leaveouts SET status = 'pending', collector_approved_at = now(),
      collector_approved_by_id = p_user, updated_at = now()
    WHERE id = l.id;
  ELSE
    UPDATE leaveouts SET status = 'declined', decided_at = now(),
      decline_reason = 'The parent did not approve ' || l.collector_name || ' to collect.', updated_at = now()
    WHERE id = l.id;
  END IF;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after)
  VALUES (l.school_id, p_user, CASE WHEN p_yes THEN 'leaveout.collector_approve' ELSE 'leaveout.collector_refuse' END,
          'leaveout', l.id::text, jsonb_build_object('collector', l.collector_name, 'via', p_via));
  RETURN l.school_id;
END
$$;
REVOKE ALL ON FUNCTION kiota_answer_collector(uuid, uuid, boolean, text) FROM PUBLIC;

-- kiota_parent_link for a given user (the SMS reply has no signed-in user).
CREATE FUNCTION kiota_parent_link_for(p_link uuid, p_user uuid) RETURNS guardian_links
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  SELECT g.* INTO v
  FROM guardian_links g
  JOIN students s ON s.id = g.student_id AND s.status = 'active'
  JOIN schools sc ON sc.id = g.school_id AND sc.status <> 'suspended'
  WHERE g.id = p_link AND g.user_id = p_user
    AND NOT EXISTS (
      SELECT 1 FROM parent_link_confirmations c
      WHERE c.guardian_link_id = g.id AND c.status <> 'confirmed'
    );
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION kiota_parent_link_for(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION app_parent_answer_collector(p_leaveout uuid, p_yes boolean) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN kiota_answer_collector(p_leaveout, app_user_id(), p_yes, 'portal');
END
$$;

-- An SMS reply "YES 1234" / "NO 1234" (or NDIYO / HAPANA) from a guardian's phone.
CREATE FUNCTION app_sms_collector_reply(p_phone text, p_code text, p_yes boolean)
RETURNS TABLE (school_id uuid, leaveout_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_leaveout uuid;
  v_school uuid;
BEGIN
  SELECT u.id INTO v_user FROM users u WHERE u.phone = p_phone;
  IF v_user IS NULL OR p_code !~ '^\d{4}$' THEN
    RETURN;
  END IF;
  SELECT l.id INTO v_leaveout FROM leaveouts l
  WHERE l.status = 'awaiting_parent' AND l.collector_confirm_code = p_code
    AND EXISTS (
      SELECT 1 FROM guardian_links g
      WHERE g.student_id = l.student_id AND g.school_id = l.school_id AND g.user_id = v_user
    )
  ORDER BY l.created_at DESC LIMIT 1;
  IF v_leaveout IS NULL THEN
    RETURN;
  END IF;
  v_school := kiota_answer_collector(v_leaveout, v_user, p_yes, 'sms');
  IF v_school IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT v_school, v_leaveout;
END
$$;

-- A parent cancels their own request (before the child has left).
CREATE FUNCTION app_parent_cancel_leaveout(p_leaveout uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l leaveouts;
BEGIN
  SELECT * INTO l FROM leaveouts WHERE id = p_leaveout FOR UPDATE;
  IF NOT FOUND OR l.status NOT IN ('awaiting_parent', 'pending', 'approved')
     OR NOT EXISTS (
       SELECT 1 FROM guardian_links g
       WHERE g.student_id = l.student_id AND g.school_id = l.school_id AND g.user_id = app_user_id()
         AND (kiota_parent_boarding_link(g.id)).id IS NOT NULL
     ) THEN
    RETURN NULL;
  END IF;
  UPDATE leaveouts SET status = 'cancelled', cancelled_at = now(), cancelled_by_id = app_user_id(),
    cancel_reason = 'Cancelled by the parent', updated_at = now()
  WHERE id = l.id;
  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, before, after)
  VALUES (l.school_id, app_user_id(), 'leaveout.cancel', 'leaveout', l.id::text,
          jsonb_build_object('status', l.status), jsonb_build_object('status', 'cancelled', 'via', 'parent'));
  RETURN l.school_id;
END
$$;

-- The background worker: schools with a student not back by their return time (not yet alerted).
CREATE FUNCTION app_due_overdue_leaveout_schools(p_now timestamptz) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT l.school_id FROM leaveouts l
  WHERE l.status = 'out' AND l.return_at < p_now AND l.overdue_alerted_at IS NULL;
END
$$;

REVOKE ALL ON FUNCTION app_parent_leaveouts(uuid), app_parent_collectors(uuid),
  app_leaveout_reasons_for_parent(uuid),
  app_parent_request_leaveout(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text),
  app_parent_answer_collector(uuid, boolean), app_sms_collector_reply(text, text, boolean),
  app_parent_cancel_leaveout(uuid), app_due_overdue_leaveout_schools(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_parent_leaveouts(uuid), app_parent_collectors(uuid),
  app_leaveout_reasons_for_parent(uuid),
  app_parent_request_leaveout(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text),
  app_parent_answer_collector(uuid, boolean), app_sms_collector_reply(text, text, boolean),
  app_parent_cancel_leaveout(uuid), app_due_overdue_leaveout_schools(timestamptz) TO kiota_app;

-- ---------------------------------------------------------------------------
-- SMS templates (configuration). Exit, return, pickup code and overdue are critical: they go
-- out at night and from an empty wallet (within the overdraft).
-- ---------------------------------------------------------------------------
INSERT INTO message_templates
  (key, language, description, category, critical, sms_body, whatsapp_name, whatsapp_body,
   whatsapp_params, whatsapp_header)
VALUES
  ('leaveout_pickup_code', 'en', 'Leave-out: the collector''s pickup code', 'boarding', true,
   '{school}: Your pickup code for {student} is {code}. Give it to the gate on {date}. Do not share it.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_pickup_code', 'sw', 'Ruhusa: nambari ya mchukuaji', 'boarding', true,
   '{school}: Nambari yako ya kumchukua {student} ni {code}. Mpe mlinzi wa geti tarehe {date}. Usimpe mtu mwingine.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_exit', 'en', 'Leave-out: the child left school', 'boarding', true,
   '{student} left {school} at {time} with {collector}.', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_exit', 'sw', 'Ruhusa: mtoto ametoka shuleni', 'boarding', true,
   '{student} ametoka {school} saa {time} pamoja na {collector}.', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_return', 'en', 'Leave-out: the child is back', 'boarding', true,
   '{student} is back at school, {time}.', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_return', 'sw', 'Ruhusa: mtoto amerudi', 'boarding', true,
   '{student} amerudi shuleni, {time}.', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_approved', 'en', 'Leave-out approved', 'boarding', false,
   '{school}: Leave-out for {student} approved, {leave} to {return}, collected by {collector}.[[ Pass: {link}]]',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_approved', 'sw', 'Ruhusa imekubaliwa', 'boarding', false,
   '{school}: Ruhusa ya {student} imekubaliwa, {leave} hadi {return}, atachukuliwa na {collector}.[[ Kibali: {link}]]',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_declined', 'en', 'Leave-out declined', 'boarding', false,
   '{school}: The leave-out request for {student} was declined. Reason: {reason}', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_declined', 'sw', 'Ruhusa imekataliwa', 'boarding', false,
   '{school}: Ombi la ruhusa ya {student} limekataliwa. Sababu: {reason}', NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_collector_confirm', 'en', 'Leave-out: the parent approves another collector', 'boarding', true,
   '{school}: {collector} ({phone}) is named to collect {student} on {date}. Reply YES {code} to approve or NO {code} to refuse.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_collector_confirm', 'sw', 'Ruhusa: mzazi akubali mchukuaji mwingine', 'boarding', true,
   '{school}: {collector} ({phone}) ametajwa kumchukua {student} tarehe {date}. Jibu NDIYO {code} kukubali au HAPANA {code} kukataa.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_overdue', 'en', 'Leave-out: the child is not back on time', 'boarding', true,
   '{school}: {student} was due back at {time} and is not yet at school. Please call the school.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_overdue', 'sw', 'Ruhusa: mtoto hajarudi kwa wakati', 'boarding', true,
   '{school}: {student} alitakiwa kurudi saa {time} na bado hajafika shuleni. Tafadhali piga simu shuleni.',
   NULL, NULL, ARRAY[]::text[], NULL);
