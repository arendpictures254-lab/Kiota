-- AlterTable
ALTER TABLE "levels" ADD COLUMN     "grading_scheme_id" UUID,
ADD COLUMN     "show_positions" BOOLEAN;

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "report_show_fee_balance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "report_show_next_term" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "report_template" TEXT NOT NULL DEFAULT 'classic';

-- CreateTable
CREATE TABLE "scheduled_runs" (
    "school_id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "run_on" DATE NOT NULL,
    "ran_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_runs_pkey" PRIMARY KEY ("school_id","job","run_on")
);

-- CreateTable
CREATE TABLE "grading_schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "default_level_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "positions_default" BOOLEAN NOT NULL DEFAULT false,
    "round_marks" BOOLEAN NOT NULL DEFAULT true,
    "for_competencies" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "min_mark" INTEGER NOT NULL,
    "max_mark" INTEGER NOT NULL,
    "comment" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "grading_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "max_marks" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_weights" (
    "school_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "assessment_weights_pkey" PRIMARY KEY ("assessment_id","subject_id")
);

-- CreateTable
CREATE TABLE "teaching_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "score_tenths" INTEGER,
    "entered_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mark_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mark_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signed_off_by_id" UUID,
    "signed_off_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "returned_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_teacher_comment" TEXT,
    "principal_comment" TEXT,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_bank" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "band_code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "competency_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "rated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_school_id_name_key" ON "grading_schemes"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_school_id_id_key" ON "grading_schemes"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grading_levels_scheme_id_code_key" ON "grading_levels"("scheme_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "grading_levels_school_id_id_key" ON "grading_levels"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_term_id_level_id_name_key" ON "assessments"("term_id", "level_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_school_id_id_key" ON "assessments"("school_id", "id");

-- CreateIndex
CREATE INDEX "teaching_assignments_school_id_membership_id_idx" ON "teaching_assignments"("school_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_assignments_stream_id_subject_id_key" ON "teaching_assignments"("stream_id", "subject_id");

-- CreateIndex
CREATE INDEX "marks_school_id_stream_id_subject_id_idx" ON "marks"("school_id", "stream_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "marks_assessment_id_subject_id_student_id_key" ON "marks"("assessment_id", "subject_id", "student_id");

-- CreateIndex
CREATE INDEX "mark_submissions_school_id_stream_id_idx" ON "mark_submissions"("school_id", "stream_id");

-- CreateIndex
CREATE UNIQUE INDEX "mark_submissions_assessment_id_subject_id_stream_id_key" ON "mark_submissions"("assessment_id", "subject_id", "stream_id");

-- CreateIndex
CREATE UNIQUE INDEX "stream_results_term_id_stream_id_key" ON "stream_results"("term_id", "stream_id");

-- CreateIndex
CREATE UNIQUE INDEX "stream_results_school_id_id_key" ON "stream_results"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "report_comments_term_id_student_id_key" ON "report_comments"("term_id", "student_id");

-- CreateIndex
CREATE INDEX "comment_bank_school_id_level_id_idx" ON "comment_bank"("school_id", "level_id");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_school_id_kind_name_key" ON "competencies"("school_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_school_id_id_key" ON "competencies"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "competency_ratings_term_id_student_id_competency_id_key" ON "competency_ratings"("term_id", "student_id", "competency_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_token_key" ON "report_cards"("token");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_term_id_student_id_key" ON "report_cards"("term_id", "student_id");

-- AddForeignKey
ALTER TABLE "grading_levels" ADD CONSTRAINT "grading_levels_school_id_scheme_id_fkey" FOREIGN KEY ("school_id", "scheme_id") REFERENCES "grading_schemes"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_term_id_fkey" FOREIGN KEY ("school_id", "term_id") REFERENCES "terms"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_level_id_fkey" FOREIGN KEY ("school_id", "level_id") REFERENCES "levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_weights" ADD CONSTRAINT "assessment_weights_school_id_assessment_id_fkey" FOREIGN KEY ("school_id", "assessment_id") REFERENCES "assessments"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_school_id_stream_id_fkey" FOREIGN KEY ("school_id", "stream_id") REFERENCES "streams"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_school_id_membership_id_fkey" FOREIGN KEY ("school_id", "membership_id") REFERENCES "memberships"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_school_id_assessment_id_fkey" FOREIGN KEY ("school_id", "assessment_id") REFERENCES "assessments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ===========================================================================
-- Written by hand: row-level security, rules, defaults and narrow functions.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Scheduled jobs (07:00 stores digest)
-- ---------------------------------------------------------------------------
ALTER TABLE scheduled_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY scheduled_runs_school ON scheduled_runs FOR ALL
  USING (school_id = (SELECT app_current_school()))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT ON scheduled_runs TO kiota_app;

-- Schools whose daily job is due: past p_hour in Nairobi, on a school day (Saturday counts when
-- any level has Saturday classes), not yet run today, for schools with the automatic member.
CREATE FUNCTION app_due_daily_job_schools(p_job text, p_now timestamptz, p_hour int)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_local timestamp := p_now AT TIME ZONE 'Africa/Nairobi';
  v_dow int := extract(dow FROM v_local)::int;
BEGIN
  IF extract(hour FROM v_local) < p_hour THEN RETURN; END IF;
  RETURN QUERY
  SELECT sc.id FROM schools sc
  LEFT JOIN school_settings st ON st.school_id = sc.id
  WHERE sc.status <> 'suspended'
    -- Jobs run as the school's automatic member: only schools that have it.
    AND EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.school_id = sc.id AND m.status = 'active' AND u.phone = 'system:messaging')
    AND (v_dow = ANY (coalesce(st.school_days, ARRAY[1,2,3,4,5]))
         OR (v_dow = 6 AND cardinality(coalesce(st.saturday_level_ids, '{}')) > 0))
    AND NOT EXISTS (SELECT 1 FROM scheduled_runs r
                    WHERE r.school_id = sc.id AND r.job = p_job AND r.run_on = v_local::date);
END
$$;
REVOKE ALL ON FUNCTION app_due_daily_job_schools(text, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_due_daily_job_schools(text, timestamptz, int) TO kiota_app;

-- ---------------------------------------------------------------------------
-- Who may see and write marks
-- ---------------------------------------------------------------------------

-- Streams the caller teaches a subject in.
CREATE FUNCTION app_my_teaching_stream_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v uuid[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT t.stream_id), '{}') INTO v
  FROM teaching_assignments t
  WHERE t.school_id = app_current_school() AND t.membership_id = app_my_membership_id();
  RETURN v;
END
$$;

-- Marks of a stream: whoever runs exams (setup, approval, post-sign-off changes), its class
-- teacher, and the teachers who teach it.
CREATE FUNCTION app_can_see_marks(p_stream uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN app_has_permission('academics.setup') OR app_has_permission('results.approve')
    OR app_has_permission('marks.unlock')
    OR p_stream = ANY (app_my_stream_ids())
    OR (app_has_permission('marks.enter') AND p_stream = ANY (app_my_teaching_stream_ids()));
END
$$;

-- Whether the stream's results for the assessment's term are past draft (marks locked).
CREATE FUNCTION app_marks_locked(p_stream uuid, p_assessment uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM stream_results r JOIN assessments a ON a.term_id = r.term_id
    WHERE a.id = p_assessment AND r.stream_id = p_stream AND r.status <> 'draft');
END
$$;

-- Writing a mark: before sign-off only the subject's assigned teacher; after it only
-- marks.unlock (the Principal), and the app logs before and after.
CREATE FUNCTION app_can_write_mark(p_stream uuid, p_subject uuid, p_assessment uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF app_marks_locked(p_stream, p_assessment) THEN
    RETURN app_has_permission('marks.unlock');
  END IF;
  RETURN app_has_permission('marks.enter') AND EXISTS (
    SELECT 1 FROM teaching_assignments t
    WHERE t.school_id = app_current_school() AND t.stream_id = p_stream
      AND t.subject_id = p_subject AND t.membership_id = app_my_membership_id());
END
$$;

-- Report data about a student (comments, ratings): the stream's class teacher, or whoever
-- approves results.
CREATE FUNCTION app_can_report_on(p_student uuid, p_permission text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF app_has_permission('results.approve') THEN RETURN true; END IF;
  RETURN app_has_permission(p_permission) AND EXISTS (
    SELECT 1 FROM students s WHERE s.id = p_student AND s.school_id = app_current_school()
      AND s.stream_id = ANY (app_my_stream_ids()));
END
$$;

REVOKE ALL ON FUNCTION app_my_teaching_stream_ids(), app_can_see_marks(uuid),
  app_marks_locked(uuid, uuid), app_can_write_mark(uuid, uuid, uuid),
  app_can_report_on(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_my_teaching_stream_ids(), app_can_see_marks(uuid),
  app_marks_locked(uuid, uuid), app_can_write_mark(uuid, uuid, uuid),
  app_can_report_on(uuid, text) TO kiota_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['grading_schemes','grading_levels','assessments','assessment_weights',
    'teaching_assignments','marks','mark_submissions','stream_results','report_comments',
    'comment_bank','competencies','competency_ratings','report_cards']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Configuration: everyone in the school reads it; academics.setup changes it.
  FOREACH t IN ARRAY ARRAY['grading_schemes','grading_levels','assessments','assessment_weights',
    'teaching_assignments','comment_bank','competencies']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (school_id = (SELECT app_current_school()))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (school_id = (SELECT app_current_school()) '
      'AND (SELECT app_has_permission(%L))) WITH CHECK (school_id = (SELECT app_current_school()) '
      'AND (SELECT app_has_permission(%L)))', t || '_setup', t, 'academics.setup', 'academics.setup');
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kiota_app', t);
  END LOOP;
END
$$;

-- Marks.
CREATE POLICY marks_select ON marks FOR SELECT
  USING (school_id = (SELECT app_current_school()) AND app_can_see_marks(stream_id));
CREATE POLICY marks_insert ON marks FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school())
              AND app_can_write_mark(stream_id, subject_id, assessment_id));
CREATE POLICY marks_update ON marks FOR UPDATE
  USING (school_id = (SELECT app_current_school())
         AND app_can_write_mark(stream_id, subject_id, assessment_id))
  WITH CHECK (school_id = (SELECT app_current_school())
              AND app_can_write_mark(stream_id, subject_id, assessment_id));
CREATE POLICY marks_delete ON marks FOR DELETE
  USING (school_id = (SELECT app_current_school())
         AND app_can_write_mark(stream_id, subject_id, assessment_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON marks TO kiota_app;
ALTER TABLE marks ADD CONSTRAINT marks_status CHECK (status IN ('score','absent','exempt'));
ALTER TABLE marks ADD CONSTRAINT marks_score CHECK (
  (status = 'score' AND score_tenths IS NOT NULL AND score_tenths >= 0)
  OR (status <> 'score' AND score_tenths IS NULL));

-- A mark above the assessment's maximum is refused, whoever writes it.
CREATE FUNCTION kiota_mark_within_max() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_max int;
BEGIN
  SELECT a.max_marks INTO v_max FROM assessments a
  WHERE a.id = NEW.assessment_id AND a.school_id = NEW.school_id;
  IF v_max IS NULL THEN RAISE EXCEPTION 'Unknown assessment'; END IF;
  IF NEW.score_tenths IS NOT NULL AND NEW.score_tenths > v_max * 10 THEN
    RAISE EXCEPTION 'Mark above the maximum of %', v_max USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER marks_within_max BEFORE INSERT OR UPDATE ON marks
  FOR EACH ROW EXECUTE FUNCTION kiota_mark_within_max();

-- Submissions: the assigned teacher (also takes one back while still in draft).
CREATE POLICY mark_submissions_select ON mark_submissions FOR SELECT
  USING (school_id = (SELECT app_current_school()) AND app_can_see_marks(stream_id));
CREATE POLICY mark_submissions_write ON mark_submissions FOR ALL
  USING (school_id = (SELECT app_current_school())
         AND app_can_write_mark(stream_id, subject_id, assessment_id))
  WITH CHECK (school_id = (SELECT app_current_school())
              AND app_can_write_mark(stream_id, subject_id, assessment_id));
GRANT SELECT, INSERT, DELETE ON mark_submissions TO kiota_app;

-- Stream results: the class teacher signs off their own stream; approvers do the rest.
CREATE POLICY stream_results_select ON stream_results FOR SELECT
  USING (school_id = (SELECT app_current_school()) AND app_can_see_marks(stream_id));
CREATE POLICY stream_results_write ON stream_results FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()) AND (
    (SELECT app_has_permission('results.approve'))
    OR ((SELECT app_has_permission('marks.signoff')) AND stream_id = ANY (app_my_stream_ids()))));
CREATE POLICY stream_results_update ON stream_results FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (
    (SELECT app_has_permission('results.approve'))
    OR ((SELECT app_has_permission('marks.signoff')) AND stream_id = ANY (app_my_stream_ids()))))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON stream_results TO kiota_app;
ALTER TABLE stream_results ADD CONSTRAINT stream_results_status
  CHECK (status IN ('draft','signed_off','approved','released'));

-- Released results are final; a class teacher can never approve or release.
CREATE FUNCTION kiota_stream_result_flow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'released' THEN
    RAISE EXCEPTION 'Released results cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('approved','released') AND NOT app_has_permission('results.approve') THEN
    RAISE EXCEPTION 'Only results.approve may approve or release' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stream_results_flow BEFORE INSERT OR UPDATE ON stream_results
  FOR EACH ROW EXECUTE FUNCTION kiota_stream_result_flow();

-- Comments and competency ratings: the class teacher (own stream) and approvers.
CREATE POLICY report_comments_select ON report_comments FOR SELECT
  USING (school_id = (SELECT app_current_school())
         AND app_can_report_on(student_id, 'reports.print'));
CREATE POLICY report_comments_write ON report_comments FOR ALL
  USING (school_id = (SELECT app_current_school())
         AND app_can_report_on(student_id, 'marks.signoff'))
  WITH CHECK (school_id = (SELECT app_current_school())
              AND app_can_report_on(student_id, 'marks.signoff'));
GRANT SELECT, INSERT, UPDATE ON report_comments TO kiota_app;
CREATE POLICY competency_ratings_select ON competency_ratings FOR SELECT
  USING (school_id = (SELECT app_current_school())
         AND app_can_report_on(student_id, 'reports.print'));
CREATE POLICY competency_ratings_write ON competency_ratings FOR ALL
  USING (school_id = (SELECT app_current_school())
         AND app_can_report_on(student_id, 'marks.signoff'))
  WITH CHECK (school_id = (SELECT app_current_school())
              AND app_can_report_on(student_id, 'marks.signoff'));
GRANT SELECT, INSERT, UPDATE, DELETE ON competency_ratings TO kiota_app;
ALTER TABLE competency_ratings ADD CONSTRAINT competency_ratings_range CHECK (rating BETWEEN 1 AND 4);

-- Report cards: issued when results are released; never changed.
CREATE POLICY report_cards_select ON report_cards FOR SELECT
  USING (school_id = (SELECT app_current_school()) AND app_can_see_marks(stream_id));
CREATE POLICY report_cards_insert ON report_cards FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school())
              AND (SELECT app_has_permission('results.approve')));
GRANT SELECT, INSERT ON report_cards TO kiota_app;
CREATE TRIGGER report_cards_append_only BEFORE UPDATE OR DELETE ON report_cards
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();

ALTER TABLE assessments ADD CONSTRAINT assessments_numbers
  CHECK (max_marks > 0 AND weight BETWEEN 0 AND 100);
ALTER TABLE assessment_weights ADD CONSTRAINT assessment_weights_range CHECK (weight BETWEEN 0 AND 100);
ALTER TABLE grading_levels ADD CONSTRAINT grading_levels_range
  CHECK (min_mark >= 0 AND max_mark <= 100 AND min_mark <= max_mark);
ALTER TABLE comment_bank ADD CONSTRAINT comment_bank_author CHECK (author IN ('class_teacher','principal'));
ALTER TABLE competencies ADD CONSTRAINT competencies_kind CHECK (kind IN ('competency','value'));
ALTER TABLE school_settings ADD CONSTRAINT school_settings_report_template
  CHECK (report_template IN ('classic','modern'));

-- ---------------------------------------------------------------------------
-- Narrow functions
-- ---------------------------------------------------------------------------

-- The students on a mark sheet: a subject teacher sees names and admission numbers of the
-- streams they teach, nothing more (never guardians or other records). Students taking chosen
-- subjects (senior school) only appear for those subjects.
CREATE FUNCTION app_mark_sheet_students(p_stream uuid, p_subject uuid)
RETURNS TABLE (id uuid, first_name text, last_name text, admission_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_can_see_marks(p_stream) THEN RETURN; END IF;
  RETURN QUERY
  SELECT s.id, s.first_name, s.last_name, s.admission_number FROM students s
  WHERE s.school_id = app_current_school() AND s.stream_id = p_stream AND s.status = 'active'
    AND (p_subject IS NULL
         OR NOT EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = s.id)
         OR EXISTS (SELECT 1 FROM student_subjects x WHERE x.student_id = s.id AND x.subject_id = p_subject))
  ORDER BY s.admission_number;
END
$$;

-- Students' subjects (chosen combinations), for the streams the caller may see marks of.
CREATE FUNCTION app_stream_student_subjects(p_stream uuid)
RETURNS TABLE (student_id uuid, subject_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_can_see_marks(p_stream) THEN RETURN; END IF;
  RETURN QUERY
  SELECT x.student_id, x.subject_id FROM student_subjects x JOIN students s ON s.id = x.student_id
  WHERE s.school_id = app_current_school() AND s.stream_id = p_stream;
END
$$;

-- Report cards: fee balances (a number only), for those who print reports.
CREATE FUNCTION app_report_fee_balances(p_students uuid[])
RETURNS TABLE (student_id uuid, balance_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_has_permission('reports.print') THEN RETURN; END IF;
  RETURN QUERY
  SELECT s.id, coalesce((SELECT sum(l.amount_cents) FROM ledger_lines l
                         WHERE l.student_id = s.id AND l.school_id = s.school_id), 0)::bigint
  FROM students s
  WHERE s.id = ANY (p_students) AND s.school_id = app_current_school()
    AND (app_has_permission('results.approve') OR app_has_permission('academics.setup')
         OR s.stream_id = ANY (app_my_stream_ids()));
END
$$;

-- Report cards: attendance in the term (counts only).
CREATE FUNCTION app_report_attendance(p_term uuid, p_students uuid[])
RETURNS TABLE (student_id uuid, present int, late int, absent int, on_leave int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t terms;
BEGIN
  IF NOT app_has_permission('reports.print') THEN RETURN; END IF;
  SELECT * INTO t FROM terms WHERE id = p_term AND school_id = app_current_school();
  IF t.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT s.id,
    count(*) FILTER (WHERE m.status = 'present')::int,
    count(*) FILTER (WHERE m.status = 'late')::int,
    count(*) FILTER (WHERE m.status = 'absent')::int,
    count(*) FILTER (WHERE m.status = 'on_leave')::int
  FROM students s
  LEFT JOIN attendance_marks m ON m.student_id = s.id AND m.school_id = s.school_id
    AND m.date BETWEEN t.start_date AND t.end_date
  WHERE s.id = ANY (p_students) AND s.school_id = app_current_school()
    AND (app_has_permission('results.approve') OR app_has_permission('academics.setup')
         OR s.stream_id = ANY (app_my_stream_ids()))
  GROUP BY s.id;
END
$$;

-- The public verification page (kiota.app/v/<token>): school, student's name, term and
-- release date. Nothing else, ever.
CREATE FUNCTION app_verify_report_card(p_token text)
RETURNS TABLE (school_name text, student_name text, term_name text, year_name text, released_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{20,40}$' THEN RETURN; END IF;
  RETURN QUERY
  SELECT sc.name, s.first_name || ' ' || s.last_name, t.name, y.name, rc.released_at
  FROM report_cards rc
  JOIN schools sc ON sc.id = rc.school_id
  JOIN students s ON s.id = rc.student_id
  JOIN terms t ON t.id = rc.term_id
  JOIN academic_years y ON y.id = t.academic_year_id
  WHERE rc.token = p_token;
END
$$;

REVOKE ALL ON FUNCTION app_mark_sheet_students(uuid, uuid), app_stream_student_subjects(uuid),
  app_report_fee_balances(uuid[]), app_report_attendance(uuid, uuid[]),
  app_verify_report_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_mark_sheet_students(uuid, uuid), app_stream_student_subjects(uuid),
  app_report_fee_balances(uuid[]), app_report_attendance(uuid, uuid[]),
  app_verify_report_card(text) TO kiota_app;

-- ---------------------------------------------------------------------------
-- Kenyan defaults (configuration: each school edits its own copy)
-- ---------------------------------------------------------------------------
CREATE FUNCTION kiota_academic_defaults(p_school uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v uuid;
  eight constant text[][] := ARRAY[
    ['EE1','Exceptional','8','90','100','Exceptional work. Keep it up.'],
    ['EE2','Very good','7','75','89','Very good work. Aim even higher.'],
    ['ME1','Good','6','58','74','Good work. Keep improving.'],
    ['ME2','Fair','5','41','57','Fair. More effort will raise this.'],
    ['AE1','Needs improvement','4','31','40','Needs improvement. Work closely with your teacher.'],
    ['AE2','Below average','3','21','30','Below average. More practice needed.'],
    ['BE1','Well below average','2','11','20','Well below expectation. Extra support needed.'],
    ['BE2','Minimal','1','0','10','Minimal attainment. Close support needed.']];
  kcse constant text[][] := ARRAY[
    ['A','A','12','80','100','Excellent.'], ['A-','A minus','11','75','79','Very good.'],
    ['B+','B plus','10','70','74','Good.'], ['B','B','9','65','69','Good. Keep it up.'],
    ['B-','B minus','8','60','64','Fairly good.'], ['C+','C plus','7','55','59','Above average.'],
    ['C','C','6','50','54','Average.'], ['C-','C minus','5','45','49','Below average.'],
    ['D+','D plus','4','40','44','Weak. Work harder.'], ['D','D','3','35','39','Weak.'],
    ['D-','D minus','2','30','34','Very weak.'], ['E','E','1','0','29','Poor. Seek help.']];
  rubric constant text[][] := ARRAY[
    ['EE','Exceeding Expectation','4','75','100','Exceeds expectations. Excellent.'],
    ['ME','Meeting Expectation','3','50','74','Meets expectations. Good work.'],
    ['AE','Approaching Expectation','2','25','49','Approaching expectations. Keep working.'],
    ['BE','Below Expectation','1','0','24','Below expectations. Needs support.']];
  i int;
BEGIN
  -- Primary (and pre-primary): the CBC 4-level rubric.
  INSERT INTO grading_schemes (school_id, name, note, default_level_keys, positions_default, for_competencies)
  VALUES (p_school, 'CBC rubric (4 levels)',
          'Confirm against current KNEC guidance. The mark ranges are a starting point.',
          ARRAY['pre_primary','primary'], false, true)
  ON CONFLICT (school_id, name) DO NOTHING RETURNING id INTO v;
  IF v IS NOT NULL THEN
    FOR i IN 1 .. array_length(rubric, 1) LOOP
      INSERT INTO grading_levels (school_id, scheme_id, code, label, points, min_mark, max_mark, comment, position)
      VALUES (p_school, v, rubric[i][1], rubric[i][2], rubric[i][3]::int, rubric[i][4]::int, rubric[i][5]::int, rubric[i][6], i);
    END LOOP;
  END IF;

  -- Junior School: the KNEC 8-level scale.
  v := NULL;
  INSERT INTO grading_schemes (school_id, name, note, default_level_keys, positions_default)
  VALUES (p_school, 'Junior School (8 levels)', 'Confirm against current KNEC guidance.',
          ARRAY['junior'], false)
  ON CONFLICT (school_id, name) DO NOTHING RETURNING id INTO v;
  IF v IS NOT NULL THEN
    FOR i IN 1 .. array_length(eight, 1) LOOP
      INSERT INTO grading_levels (school_id, scheme_id, code, label, points, min_mark, max_mark, comment, position)
      VALUES (p_school, v, eight[i][1], eight[i][2], eight[i][3]::int, eight[i][4]::int, eight[i][5]::int, eight[i][6], i);
    END LOOP;
  END IF;

  -- Senior School: the 8-level scale as a starting point.
  v := NULL;
  INSERT INTO grading_schemes (school_id, name, note, default_level_keys, positions_default)
  VALUES (p_school, 'Senior School (8 levels, provisional)',
          'To be confirmed when KNEC publishes the senior school scale.', ARRAY['senior'], false)
  ON CONFLICT (school_id, name) DO NOTHING RETURNING id INTO v;
  IF v IS NOT NULL THEN
    FOR i IN 1 .. array_length(eight, 1) LOOP
      INSERT INTO grading_levels (school_id, scheme_id, code, label, points, min_mark, max_mark, comment, position)
      VALUES (p_school, v, eight[i][1], eight[i][2], eight[i][3]::int, eight[i][4]::int, eight[i][5]::int, eight[i][6], i);
    END LOOP;
  END IF;

  -- 8-4-4 (Forms 3 and 4): KCSE grades, mean grade from points, positions on.
  v := NULL;
  INSERT INTO grading_schemes (school_id, name, note, default_level_keys, positions_default)
  VALUES (p_school, 'KCSE (8-4-4)', 'Mark ranges vary by school: edit them to match yours.',
          ARRAY['legacy_844'], true)
  ON CONFLICT (school_id, name) DO NOTHING RETURNING id INTO v;
  IF v IS NOT NULL THEN
    FOR i IN 1 .. array_length(kcse, 1) LOOP
      INSERT INTO grading_levels (school_id, scheme_id, code, label, points, min_mark, max_mark, comment, position)
      VALUES (p_school, v, kcse[i][1], kcse[i][2], kcse[i][3]::int, kcse[i][4]::int, kcse[i][5]::int, kcse[i][6], i);
    END LOOP;
  END IF;

  INSERT INTO competencies (school_id, kind, name, position)
  SELECT p_school, 'competency', n, o FROM unnest(ARRAY[
    'Communication and collaboration','Critical thinking and problem solving',
    'Creativity and imagination','Citizenship','Digital literacy','Learning to learn',
    'Self-efficacy']) WITH ORDINALITY AS c(n, o)
  ON CONFLICT (school_id, kind, name) DO NOTHING;
  INSERT INTO competencies (school_id, kind, name, position)
  SELECT p_school, 'value', n, o FROM unnest(ARRAY[
    'Love','Responsibility','Respect','Unity','Peace','Patriotism','Social justice',
    'Integrity']) WITH ORDINALITY AS c(n, o)
  ON CONFLICT (school_id, kind, name) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION kiota_academic_defaults(uuid) FROM PUBLIC;

CREATE FUNCTION kiota_academic_defaults_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM kiota_academic_defaults(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER schools_academic_defaults AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION kiota_academic_defaults_trigger();
SELECT kiota_academic_defaults(id) FROM schools;

-- Class positions: the marks of every stream in the stream's class (ids and numbers only, no
-- names), for whoever may see this stream's marks.
CREATE FUNCTION app_class_marks(p_stream uuid, p_term uuid)
RETURNS TABLE (student_id uuid, stream_id uuid, assessment_id uuid, subject_id uuid, status text, score_tenths int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_can_see_marks(p_stream) THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.student_id, m.stream_id, m.assessment_id, m.subject_id, m.status, m.score_tenths
  FROM marks m
  JOIN assessments a ON a.id = m.assessment_id AND a.term_id = p_term
  JOIN streams st ON st.id = m.stream_id
  JOIN students s ON s.id = m.student_id AND s.status = 'active'
  WHERE m.school_id = app_current_school()
    AND st.class_id = (SELECT x.class_id FROM streams x WHERE x.id = p_stream AND x.school_id = app_current_school());
END
$$;
REVOKE ALL ON FUNCTION app_class_marks(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_class_marks(uuid, uuid) TO kiota_app;
