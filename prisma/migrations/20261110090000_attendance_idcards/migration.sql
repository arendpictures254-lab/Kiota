-- AlterTable
ALTER TABLE "leaveouts" ADD COLUMN     "collector_link_hash" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "photo_original_key" TEXT;

-- CreateTable
CREATE TABLE "school_settings" (
    "school_id" UUID NOT NULL,
    "leaveout_early_exit_minutes" INTEGER NOT NULL DEFAULT 60,
    "absence_sms_day_scholars" BOOLEAN NOT NULL DEFAULT true,
    "absence_sms_delay_minutes" INTEGER NOT NULL DEFAULT 30,
    "absence_sms_boarders" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_settings_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "opens_minute" INTEGER NOT NULL,
    "cutoff_minute" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_registers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "corrected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "leaveout_id" UUID,
    "marked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "mark_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absence_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "in_at" TIMESTAMPTZ(3),
    "out_at" TIMESTAMPTZ(3),
    "source" TEXT NOT NULL,
    "marked_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "valid_until_year" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "student_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_school_id_name_key" ON "attendance_sessions"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_school_id_id_key" ON "attendance_sessions"("school_id", "id");

-- CreateIndex
CREATE INDEX "attendance_registers_school_id_date_idx" ON "attendance_registers"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_registers_school_id_stream_id_session_id_date_key" ON "attendance_registers"("school_id", "stream_id", "session_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_registers_school_id_id_key" ON "attendance_registers"("school_id", "id");

-- CreateIndex
CREATE INDEX "attendance_marks_school_id_student_id_date_idx" ON "attendance_marks"("school_id", "student_id", "date");

-- CreateIndex
CREATE INDEX "attendance_marks_school_id_date_idx" ON "attendance_marks"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_marks_register_id_student_id_key" ON "attendance_marks"("register_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_marks_school_id_id_key" ON "attendance_marks"("school_id", "id");

-- CreateIndex
CREATE INDEX "absence_alerts_school_id_status_idx" ON "absence_alerts"("school_id", "status");

-- CreateIndex
CREATE INDEX "absence_alerts_school_id_mark_id_idx" ON "absence_alerts"("school_id", "mark_id");

-- CreateIndex
CREATE INDEX "staff_attendance_school_id_date_idx" ON "staff_attendance"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_school_id_membership_id_date_key" ON "staff_attendance"("school_id", "membership_id", "date");

-- CreateIndex
CREATE INDEX "student_cards_school_id_student_id_idx" ON "student_cards"("school_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_cards_school_id_id_key" ON "student_cards"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leaveouts_collector_link_hash_key" ON "leaveouts"("collector_link_hash");

-- AddForeignKey
ALTER TABLE "attendance_registers" ADD CONSTRAINT "attendance_registers_school_id_stream_id_fkey" FOREIGN KEY ("school_id", "stream_id") REFERENCES "streams"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_registers" ADD CONSTRAINT "attendance_registers_school_id_session_id_fkey" FOREIGN KEY ("school_id", "session_id") REFERENCES "attendance_sessions"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_school_id_register_id_fkey" FOREIGN KEY ("school_id", "register_id") REFERENCES "attendance_registers"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_alerts" ADD CONSTRAINT "absence_alerts_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_school_id_membership_id_fkey" FOREIGN KEY ("school_id", "membership_id") REFERENCES "memberships"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Written by hand: row-level security, grants, defaults, functions, templates.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Permissions: attendance.mark becomes attendance.take (same people), and the new ones.
-- The catalogue sync (prisma/setup.ts) adds the descriptions and role bundles.
-- ---------------------------------------------------------------------------
INSERT INTO permissions (key, description) VALUES
  ('attendance.take', 'Take the class register for your own streams')
ON CONFLICT (key) DO NOTHING;
UPDATE role_permissions SET permission_key = 'attendance.take'
WHERE permission_key = 'attendance.mark'
  AND NOT EXISTS (SELECT 1 FROM role_permissions r2
                  WHERE r2.role_id = role_permissions.role_id AND r2.permission_key = 'attendance.take');
UPDATE permission_grants SET permission_key = 'attendance.take' WHERE permission_key = 'attendance.mark';
DELETE FROM role_permissions WHERE permission_key = 'attendance.mark';
DELETE FROM permissions WHERE key = 'attendance.mark';

-- The caller's own membership at the current school (for "staff mark only themselves").
CREATE FUNCTION app_my_membership_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  SELECT m.id INTO v FROM memberships m
  WHERE m.user_id = app_user_id() AND m.school_id = app_current_school() AND m.status = 'active';
  RETURN v;
END
$$;
REVOKE ALL ON FUNCTION app_my_membership_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_my_membership_id() TO kiota_app;

-- ---------------------------------------------------------------------------
-- School settings: one row per school, made with the school.
-- ---------------------------------------------------------------------------
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY school_settings_select ON school_settings FOR SELECT
  USING (school_id = (SELECT app_current_school()));
CREATE POLICY school_settings_update ON school_settings FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('school.settings.manage'))
         OR (SELECT app_has_permission('attendance.manage')))
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, UPDATE ON school_settings TO kiota_app;
ALTER TABLE school_settings ADD CONSTRAINT school_settings_early_exit
  CHECK (leaveout_early_exit_minutes BETWEEN 0 AND 720);
ALTER TABLE school_settings ADD CONSTRAINT school_settings_sms_delay
  CHECK (absence_sms_delay_minutes BETWEEN 0 AND 240);
ALTER TABLE school_settings ADD CONSTRAINT school_settings_school
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT;

-- Default register times: Morning (cut-off 08:30) and Afternoon (cut-off 14:30).
CREATE FUNCTION kiota_school_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO school_settings (school_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO attendance_sessions (school_id, name, opens_minute, cutoff_minute, position)
  VALUES (NEW.id, 'Morning', 450, 510, 1), (NEW.id, 'Afternoon', 840, 870, 2)
  ON CONFLICT (school_id, name) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER schools_defaults AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION kiota_school_defaults();
INSERT INTO school_settings (school_id) SELECT id FROM schools ON CONFLICT DO NOTHING;
INSERT INTO attendance_sessions (school_id, name, opens_minute, cutoff_minute, position)
SELECT s.id, d.name, d.opens, d.cutoff, d.position
FROM schools s
CROSS JOIN (VALUES ('Morning', 450, 510, 1), ('Afternoon', 840, 870, 2)) AS d(name, opens, cutoff, position)
ON CONFLICT (school_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_sessions_select ON attendance_sessions FOR SELECT
  USING (school_id = (SELECT app_current_school()));
CREATE POLICY attendance_sessions_insert ON attendance_sessions FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('attendance.manage')));
CREATE POLICY attendance_sessions_update ON attendance_sessions FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('attendance.manage')))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON attendance_sessions TO kiota_app;
ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_times
  CHECK (opens_minute BETWEEN 0 AND 1439 AND cutoff_minute BETWEEN 0 AND 1439 AND cutoff_minute >= opens_minute);

-- Registers: attendance.manage for the whole school; attendance.take for your own streams.
ALTER TABLE attendance_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_registers FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_registers_select ON attendance_registers FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('attendance.manage'))
      OR (SELECT app_has_permission('students.view'))
      OR ((SELECT app_has_permission('attendance.take')) AND stream_id IN (SELECT unnest(app_my_stream_ids())))
    )
  );
CREATE POLICY attendance_registers_insert ON attendance_registers FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('attendance.manage'))
      OR ((SELECT app_has_permission('attendance.take')) AND stream_id IN (SELECT unnest(app_my_stream_ids())))
    )
  );
CREATE POLICY attendance_registers_update ON attendance_registers FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('attendance.manage'))
      OR ((SELECT app_has_permission('attendance.take')) AND stream_id IN (SELECT unnest(app_my_stream_ids())))
    )
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON attendance_registers TO kiota_app;

-- Marks follow the student's visibility (a class teacher sees their own streams); writing needs
-- the register to be one you may take.
ALTER TABLE attendance_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_marks_select ON attendance_marks FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM students s WHERE s.id = attendance_marks.student_id)
  );
CREATE POLICY attendance_marks_insert ON attendance_marks FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM attendance_registers r WHERE r.id = attendance_marks.register_id)
    AND ((SELECT app_has_permission('attendance.manage')) OR (SELECT app_has_permission('attendance.take')))
  );
CREATE POLICY attendance_marks_update ON attendance_marks FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM attendance_registers r WHERE r.id = attendance_marks.register_id)
    AND ((SELECT app_has_permission('attendance.manage')) OR (SELECT app_has_permission('attendance.take')))
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON attendance_marks TO kiota_app;
ALTER TABLE attendance_marks ADD CONSTRAINT attendance_marks_status
  CHECK (status IN ('present', 'absent', 'late', 'on_leave'));

-- Absence alerts: written by whoever takes the register, resolved by boarding staff, sent by
-- the school's automatic-messages member.
ALTER TABLE absence_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY absence_alerts_select ON absence_alerts FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM students s WHERE s.id = absence_alerts.student_id)
  );
CREATE POLICY absence_alerts_insert ON absence_alerts FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('attendance.manage')) OR (SELECT app_has_permission('attendance.take')))
  );
CREATE POLICY absence_alerts_update ON absence_alerts FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM students s WHERE s.id = absence_alerts.student_id)
    AND (
      (SELECT app_has_permission('attendance.manage'))
      OR (SELECT app_has_permission('attendance.take'))
      OR (SELECT app_has_permission('boarding.manage'))
      OR (SELECT app_has_permission('boarding.alerts'))
    )
  )
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON absence_alerts TO kiota_app;

-- Staff attendance: everyone marks only their own day; staff_attendance.manage marks anyone.
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_select ON staff_attendance FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      membership_id = (SELECT app_my_membership_id())
      OR (SELECT app_has_permission('staff_attendance.manage'))
    )
  );
CREATE POLICY staff_attendance_insert ON staff_attendance FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND (
      (membership_id = (SELECT app_my_membership_id()) AND source = 'self')
      OR (SELECT app_has_permission('staff_attendance.manage'))
    )
  );
CREATE POLICY staff_attendance_update ON staff_attendance FOR UPDATE
  USING (
    school_id = (SELECT app_current_school())
    AND (
      membership_id = (SELECT app_my_membership_id())
      OR (SELECT app_has_permission('staff_attendance.manage'))
    )
  )
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND (
      (membership_id = (SELECT app_my_membership_id()) AND source = 'self')
      OR (SELECT app_has_permission('staff_attendance.manage'))
    )
  );
GRANT SELECT, INSERT, UPDATE ON staff_attendance TO kiota_app;
ALTER TABLE staff_attendance ADD CONSTRAINT staff_attendance_status
  CHECK (status IN ('present', 'absent', 'leave'));

-- ---------------------------------------------------------------------------
-- Student ID cards
-- ---------------------------------------------------------------------------
ALTER TABLE student_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY student_cards_select ON student_cards FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM students s WHERE s.id = student_cards.student_id)
  );
CREATE POLICY student_cards_insert ON student_cards FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('idcards.print')));
CREATE POLICY student_cards_update ON student_cards FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('idcards.print')))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON student_cards TO kiota_app;
-- At most one live card per student.
CREATE UNIQUE INDEX student_cards_one_live ON student_cards (school_id, student_id) WHERE revoked_at IS NULL;

-- A card scanned at the gate: the guard (gate.scan) never reads student records, so this returns
-- only what the guard needs to see, and nothing for a card of another school.
CREATE FUNCTION app_gate_card(p_card uuid, p_nonce text)
RETURNS TABLE (
  card_id uuid, live boolean, valid_until_year int, student_id uuid, first_name text,
  last_name text, admission_number text, class_label text, boarder boolean, photo_key text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_has_permission('gate.scan') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id, c.revoked_at IS NULL, c.valid_until_year, s.id, s.first_name, s.last_name,
         s.admission_number, cl.name || coalesce(' ' || st.name, ''), s.boarder, s.photo_key
  FROM student_cards c
  JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id
  JOIN classes cl ON cl.id = s.class_id
  LEFT JOIN streams st ON st.id = s.stream_id
  WHERE c.id = p_card AND c.nonce = p_nonce AND c.school_id = app_current_school();
END
$$;
REVOKE ALL ON FUNCTION app_gate_card(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_gate_card(uuid, text) TO kiota_app;

-- ---------------------------------------------------------------------------
-- Leave-outs: the parent's "Tap to approve" link, and the background worker
-- ---------------------------------------------------------------------------

-- The leave-out behind an approval link, for the signed-in parent: their own guardian link to
-- that child (receiving boarding messages), or nothing.
CREATE FUNCTION app_parent_collector_link(p_hash text)
RETURNS TABLE (link_id uuid, leaveout_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT g.id, l.id
  FROM leaveouts l
  JOIN guardian_links g ON g.student_id = l.student_id AND g.school_id = l.school_id
  WHERE l.collector_link_hash = p_hash AND g.user_id = app_user_id()
    AND (kiota_parent_boarding_link(g.id)).id IS NOT NULL
  LIMIT 1;
END
$$;

-- Schools with an absence alert whose SMS is due (worker).
CREATE FUNCTION app_due_absence_alert_schools(p_now timestamptz) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT a.school_id FROM absence_alerts a
  WHERE a.kind = 'parent_sms' AND a.status = 'waiting' AND a.due_at <= p_now;
END
$$;
REVOKE ALL ON FUNCTION app_parent_collector_link(text), app_due_absence_alert_schools(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_parent_collector_link(text), app_due_absence_alert_schools(timestamptz) TO kiota_app;

-- ---------------------------------------------------------------------------
-- SMS templates
-- ---------------------------------------------------------------------------
-- The collector approval is now a link, not "Reply YES 1234" (an alphanumeric sender ID cannot
-- receive replies). The reply route stays in the code, switched off (SMS_REPLIES=on).
UPDATE message_templates SET sms_body =
  '{school}: {collector} ({phone}) will collect {student} on {date}. Tap to approve: {link}'
WHERE key = 'leaveout_collector_confirm' AND language = 'en';
UPDATE message_templates SET sms_body =
  '{school}: {collector} ({phone}) atamchukua {student} tarehe {date}. Bonyeza kukubali: {link}'
WHERE key = 'leaveout_collector_confirm' AND language = 'sw';

INSERT INTO message_templates
  (key, language, description, category, critical, sms_body, whatsapp_name, whatsapp_body,
   whatsapp_params, whatsapp_header)
VALUES
  ('leaveout_cancelled', 'en', 'Leave-out cancelled', 'boarding', true,
   '{school}: The leave-out for {student} on {date} was cancelled. The pass no longer works. Reason: {reason}',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('leaveout_cancelled', 'sw', 'Ruhusa imefutwa', 'boarding', true,
   '{school}: Ruhusa ya {student} ya tarehe {date} imefutwa. Kibali hakitumiki tena. Sababu: {reason}',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_absent', 'en', 'Attendance: a day scholar is absent', 'general', false,
   '{school}: {student} was marked absent from the {session} register today, {date}. If this is a mistake, please call the school.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_absent', 'sw', 'Mahudhurio: mwanafunzi wa kutwa hayupo', 'general', false,
   '{school}: {student} hakuwepo kwenye mahudhurio ya {session} leo, {date}. Ikiwa ni kosa, tafadhali piga simu shuleni.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_boarder_absent', 'en', 'Attendance: a boarder is absent from class', 'boarding', false,
   '{school}: {student} was not in class for the {session} register today, {date}. The boarding staff are checking.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_boarder_absent', 'sw', 'Mahudhurio: mwanafunzi wa bweni hayupo darasani', 'boarding', false,
   '{school}: {student} hakuwepo darasani kwenye mahudhurio ya {session} leo, {date}. Walezi wa bweni wanafuatilia.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_not_found', 'en', 'Attendance: a boarder cannot be found', 'boarding', true,
   '{school}: URGENT. {student} was absent from class today and the boarding staff cannot find them at school. Please call the school now.',
   NULL, NULL, ARRAY[]::text[], NULL),
  ('attendance_not_found', 'sw', 'Mahudhurio: mwanafunzi wa bweni hapatikani', 'boarding', true,
   '{school}: DHARURA. {student} hakuwepo darasani leo na walezi wa bweni hawajampata shuleni. Tafadhali piga simu shuleni sasa.',
   NULL, NULL, ARRAY[]::text[], NULL);
