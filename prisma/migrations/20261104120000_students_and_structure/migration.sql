-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('active', 'transferred', 'graduated', 'suspended', 'withdrawn');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('mother', 'father', 'guardian', 'sponsor', 'other');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'sw');


-- CreateTable
CREATE TABLE "level_templates" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "grades" TEXT[],
    "subjects" TEXT[],
    "pathways" TEXT[],
    "next_level_key" TEXT,

    CONSTRAINT "level_templates_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "next_level_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "class_teacher_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "houses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dormitories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bed_capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dormitories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "half_term_start" DATE,
    "half_term_end" DATE,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathways" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "admission_number" TEXT NOT NULL,
    "upi" TEXT,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "photo_key" TEXT,
    "class_id" UUID NOT NULL,
    "stream_id" UUID,
    "boarder" BOOLEAN NOT NULL DEFAULT false,
    "house_id" UUID,
    "pathway_id" UUID,
    "special_needs" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'active',
    "status_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_medical" (
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "medical_notes" TEXT,
    "allergies" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_medical_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "student_status_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_status" "StudentStatus",
    "to_status" "StudentStatus" NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "changed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_subjects" (
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,

    CONSTRAINT "student_subjects_pkey" PRIMARY KEY ("student_id","subject_id")
);

-- CreateTable
CREATE TABLE "student_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "receives_fees" BOOLEAN NOT NULL DEFAULT true,
    "receives_academics" BOOLEAN NOT NULL DEFAULT true,
    "receives_boarding" BOOLEAN NOT NULL DEFAULT true,
    "authorised_to_collect" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guardian_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_link_confirmations" (
    "guardian_link_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "parent_link_confirmations_pkey" PRIMARY KEY ("guardian_link_id")
);

-- CreateTable
CREATE TABLE "opening_balances" (
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "summary" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "levels_school_id_key_key" ON "levels"("school_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "levels_school_id_id_key" ON "levels"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_school_id_name_key" ON "classes"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "classes_school_id_id_key" ON "classes"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "streams_class_id_name_key" ON "streams"("class_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "streams_school_id_id_key" ON "streams"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "houses_school_id_name_key" ON "houses"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "houses_school_id_id_key" ON "houses"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dormitories_school_id_name_key" ON "dormitories"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_name_key" ON "academic_years"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_id_key" ON "academic_years"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_academic_year_id_name_key" ON "terms"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pathways_level_id_name_key" ON "pathways"("level_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pathways_school_id_id_key" ON "pathways"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_level_id_name_key" ON "subjects"("level_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_id_key" ON "subjects"("school_id", "id");

-- CreateIndex
CREATE INDEX "students_school_id_class_id_stream_id_idx" ON "students"("school_id", "class_id", "stream_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_admission_number_key" ON "students"("school_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_id_key" ON "students"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "student_medical_school_id_student_id_key" ON "student_medical"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "student_status_changes_student_id_created_at_idx" ON "student_status_changes"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "guardian_links_user_id_idx" ON "guardian_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_links_student_id_user_id_key" ON "guardian_links"("student_id", "user_id");

-- CreateIndex
CREATE INDEX "parent_link_confirmations_user_id_idx" ON "parent_link_confirmations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_school_id_student_id_key" ON "opening_balances"("school_id", "student_id");

-- AddForeignKey
ALTER TABLE "levels" ADD CONSTRAINT "levels_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_level_id_fkey" FOREIGN KEY ("school_id", "level_id") REFERENCES "levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streams" ADD CONSTRAINT "streams_school_id_class_id_fkey" FOREIGN KEY ("school_id", "class_id") REFERENCES "classes"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streams" ADD CONSTRAINT "streams_school_id_class_teacher_membership_id_fkey" FOREIGN KEY ("school_id", "class_teacher_membership_id") REFERENCES "memberships"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "houses" ADD CONSTRAINT "houses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dormitories" ADD CONSTRAINT "dormitories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathways" ADD CONSTRAINT "pathways_school_id_level_id_fkey" FOREIGN KEY ("school_id", "level_id") REFERENCES "levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_level_id_fkey" FOREIGN KEY ("school_id", "level_id") REFERENCES "levels"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_class_id_fkey" FOREIGN KEY ("school_id", "class_id") REFERENCES "classes"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_stream_id_fkey" FOREIGN KEY ("school_id", "stream_id") REFERENCES "streams"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_house_id_fkey" FOREIGN KEY ("school_id", "house_id") REFERENCES "houses"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_pathway_id_fkey" FOREIGN KEY ("school_id", "pathway_id") REFERENCES "pathways"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_medical" ADD CONSTRAINT "student_medical_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_changes" ADD CONSTRAINT "student_status_changes_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_documents" ADD CONSTRAINT "student_documents_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_link_confirmations" ADD CONSTRAINT "parent_link_confirmations_guardian_link_id_fkey" FOREIGN KEY ("guardian_link_id") REFERENCES "guardian_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: Kenyan level defaults, backfill, grants, row-level security
-- ===========================================================================

-- Kenyan defaults. Configuration data: schools copy these and can change their own copies.
INSERT INTO level_templates (key, name, sort_order, grades, subjects, pathways, next_level_key) VALUES
('pre_primary', 'Pre-primary', 10, ARRAY['PP1','PP2'],
  ARRAY['Language Activities','Mathematical Activities','Environmental Activities',
        'Psychomotor and Creative Activities','Religious Education Activities'],
  ARRAY[]::text[], 'primary'),
('primary', 'Primary', 20, ARRAY['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'],
  ARRAY['English','Kiswahili','Mathematics','Science and Technology','Social Studies',
        'Agriculture and Nutrition','Creative Arts','Religious Education'],
  ARRAY[]::text[], 'junior'),
('junior', 'Junior School', 30, ARRAY['Grade 7','Grade 8','Grade 9'],
  ARRAY['English','Kiswahili','Mathematics','Integrated Science','Social Studies',
        'Pre-Technical Studies','Agriculture and Nutrition','Creative Arts and Sports',
        'Religious Education'],
  ARRAY[]::text[], 'senior'),
('senior', 'Senior School', 40, ARRAY['Grade 10','Grade 11','Grade 12'],
  ARRAY['English','Kiswahili','Core Mathematics','Community Service Learning',
        'Physical Education','Biology','Chemistry','Physics','Computer Studies','Geography',
        'History and Citizenship','Business Studies','Agriculture','Fine Arts',
        'Music and Dance','Sports and Recreation','Christian Religious Education',
        'Islamic Religious Education'],
  ARRAY['STEM','Social Sciences','Arts and Sports Science'], NULL),
('legacy_844', '8-4-4', 50, ARRAY['Form 3','Form 4'],
  ARRAY['English','Kiswahili','Mathematics','Biology','Chemistry','Physics','Geography',
        'History and Government','Christian Religious Education','Business Studies',
        'Agriculture','Computer Studies'],
  ARRAY[]::text[], NULL)
ON CONFLICT (key) DO NOTHING;

-- Copy the level templates into one school: every level (enabled or not) with its classes;
-- subjects and pathways only for enabled levels. Internal: not callable by the app role.
CREATE FUNCTION kiota_copy_level_templates(p_school uuid, p_enabled text[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = public
AS $$
DECLARE
  t level_templates%ROWTYPE;
  v_level uuid;
  i int;
BEGIN
  FOR t IN SELECT * FROM level_templates ORDER BY sort_order LOOP
    INSERT INTO levels (school_id, key, name, sort_order, enabled, next_level_key)
    VALUES (p_school, t.key, t.name, t.sort_order, t.key = ANY(p_enabled), t.next_level_key)
    ON CONFLICT (school_id, key) DO NOTHING;
    SELECT id INTO v_level FROM levels WHERE school_id = p_school AND key = t.key;

    FOR i IN 1 .. coalesce(array_length(t.grades, 1), 0) LOOP
      INSERT INTO classes (school_id, level_id, name, position)
      VALUES (p_school, v_level, t.grades[i], i)
      ON CONFLICT (school_id, name) DO NOTHING;
    END LOOP;

    IF t.key = ANY(p_enabled) THEN
      INSERT INTO subjects (school_id, level_id, name)
      SELECT p_school, v_level, unnest(t.subjects)
      ON CONFLICT (level_id, name) DO NOTHING;
      INSERT INTO pathways (school_id, level_id, name)
      SELECT p_school, v_level, unnest(t.pathways)
      ON CONFLICT (level_id, name) DO NOTHING;
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION kiota_copy_level_templates(uuid, text[]) FROM PUBLIC;

-- Backfill existing schools from the old levels_offered column, then drop it.
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT id, levels_offered FROM schools LOOP
    PERFORM kiota_copy_level_templates(s.id, s.levels_offered);
  END LOOP;
END
$$;

ALTER TABLE schools DROP COLUMN levels_offered;

-- app_create_school: levels now come from the templates.
CREATE OR REPLACE FUNCTION app_create_school(
  p_name text, p_short_name text, p_county text, p_levels text[],
  p_director_phone text, p_director_name text, p_ip text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school uuid;
  v_director uuid;
  v_membership uuid;
  v_role uuid;
BEGIN
  IF NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_levels) k WHERE k NOT IN (SELECT key FROM level_templates)) THEN
    RAISE EXCEPTION 'unknown level' USING ERRCODE = '22023';
  END IF;

  INSERT INTO schools (name, short_name, county, updated_at)
  VALUES (p_name, p_short_name, p_county, now())
  RETURNING id INTO v_school;

  PERFORM kiota_copy_level_templates(v_school, p_levels);

  v_director := app_ensure_user(p_director_phone, p_director_name);

  INSERT INTO memberships (school_id, user_id, updated_at)
  VALUES (v_school, v_director, now())
  RETURNING id INTO v_membership;

  SELECT id INTO v_role FROM roles WHERE key = 'director';
  INSERT INTO membership_roles (school_id, membership_id, role_id)
  VALUES (v_school, v_membership, v_role);

  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after, ip)
  VALUES (
    v_school, app_user_id(), 'school.create', 'school', v_school::text,
    jsonb_build_object(
      'name', p_name, 'shortName', p_short_name, 'county', p_county,
      'levelsOffered', p_levels, 'directorUserId', v_director
    ),
    p_ip
  );

  RETURN v_school;
END
$$;

-- ---------------------------------------------------------------------------
-- Permission helpers for policies
-- ---------------------------------------------------------------------------

-- Does the current user hold permission p in the current school (by role or direct grant)?
-- Arend admins with support access may view students, never medical records.
CREATE FUNCTION app_has_permission(p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT app_current_school() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM memberships m
      JOIN membership_roles mr ON mr.membership_id = m.id
      JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE m.user_id = app_user_id() AND m.school_id = app_current_school()
        AND m.status = 'active' AND rp.permission_key = p
    )
    OR EXISTS (
      SELECT 1 FROM memberships m
      JOIN permission_grants g ON g.membership_id = m.id
      WHERE m.user_id = app_user_id() AND m.school_id = app_current_school()
        AND m.status = 'active' AND g.permission_key = p
    )
    OR (
      p = 'students.view' AND app_is_platform_admin()
      AND NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = app_user_id() AND m.school_id = app_current_school()
      )
    )
  )
$$;

-- Streams the current user is class teacher of, in the current school.
CREATE FUNCTION app_my_stream_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(array_agg(s.id), '{}')
  FROM streams s
  JOIN memberships m ON m.id = s.class_teacher_membership_id
  WHERE s.school_id = app_current_school() AND m.user_id = app_user_id() AND m.status = 'active'
$$;

-- Link a guardian (by phone) to a student in the current school. Reuses the platform identity
-- for that phone. If the parent already has confirmed links at another school and none here,
-- the new link waits for the parent to confirm by SMS (recorded where the school cannot see it).
CREATE FUNCTION app_upsert_guardian_link(
  p_student uuid, p_phone text, p_name text, p_relationship text, p_language text,
  p_receives_fees boolean, p_receives_academics boolean, p_receives_boarding boolean,
  p_authorised_to_collect boolean
) RETURNS TABLE (link_id uuid, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school uuid := app_current_school();
  v_user uuid;
  v_link uuid;
  v_created boolean;
BEGIN
  IF v_school IS NULL
     OR NOT (app_has_permission('students.edit') OR app_has_permission('import.run')) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student AND school_id = v_school) THEN
    RAISE EXCEPTION 'student not found' USING ERRCODE = '22023';
  END IF;

  v_user := app_ensure_user(p_phone, p_name);

  INSERT INTO guardian_links (
    school_id, student_id, user_id, name, relationship, language, receives_fees,
    receives_academics, receives_boarding, authorised_to_collect, updated_at
  ) VALUES (
    v_school, p_student, v_user, p_name, p_relationship::"GuardianRelationship",
    p_language::"Language", p_receives_fees, p_receives_academics, p_receives_boarding,
    p_authorised_to_collect, now()
  )
  ON CONFLICT (student_id, user_id) DO UPDATE SET
    name = EXCLUDED.name,
    relationship = EXCLUDED.relationship,
    language = EXCLUDED.language,
    receives_fees = EXCLUDED.receives_fees,
    receives_academics = EXCLUDED.receives_academics,
    receives_boarding = EXCLUDED.receives_boarding,
    authorised_to_collect = EXCLUDED.authorised_to_collect,
    updated_at = now()
  RETURNING id, (xmax = 0) INTO v_link, v_created;

  IF v_created
     AND EXISTS (
       SELECT 1 FROM guardian_links g
       WHERE g.user_id = v_user AND g.school_id <> v_school
         AND NOT EXISTS (
           SELECT 1 FROM parent_link_confirmations c
           WHERE c.guardian_link_id = g.id AND c.status = 'pending'
         )
     )
     AND NOT EXISTS (
       SELECT 1 FROM guardian_links g
       WHERE g.user_id = v_user AND g.school_id = v_school AND g.id <> v_link
         AND NOT EXISTS (
           SELECT 1 FROM parent_link_confirmations c
           WHERE c.guardian_link_id = g.id AND c.status = 'pending'
         )
     )
  THEN
    INSERT INTO parent_link_confirmations (guardian_link_id, user_id) VALUES (v_link, v_user);
  END IF;

  RETURN QUERY SELECT v_link, v_created;
END
$$;

REVOKE ALL ON FUNCTION app_has_permission(text), app_my_stream_ids(),
  app_upsert_guardian_link(uuid, text, text, text, text, boolean, boolean, boolean, boolean)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_has_permission(text), app_my_stream_ids(),
  app_upsert_guardian_link(uuid, text, text, text, text, boolean, boolean, boolean, boolean)
TO kiota_app;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON level_templates TO kiota_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  levels, classes, streams, houses, dormitories, academic_years, terms, pathways, subjects,
  student_subjects, guardian_links
TO kiota_app;
-- Students are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON students, student_medical, opening_balances, import_batches
TO kiota_app;
-- Append-only history and documents.
GRANT SELECT, INSERT ON student_status_changes, student_documents TO kiota_app;
-- Only the parent reads their own pending confirmations (parent portal); schools never.
GRANT SELECT ON parent_link_confirmations TO kiota_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'levels','classes','streams','houses','dormitories','academic_years','terms','pathways',
    'subjects','students','student_medical','student_status_changes','student_subjects',
    'student_documents','guardian_links','parent_link_confirmations','opening_balances',
    'import_batches'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Plain school wall for structure tables and import batches.
  FOREACH t IN ARRAY ARRAY[
    'levels','classes','streams','houses','dormitories','academic_years','terms','pathways',
    'subjects','import_batches'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (school_id = (SELECT app_current_school())) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;

  -- Tables about one student: visible only if the student is visible.
  FOREACH t IN ARRAY ARRAY[
    'student_status_changes','student_subjects','student_documents','guardian_links',
    'opening_balances'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING (school_id = (SELECT app_current_school()) '
      '       AND EXISTS (SELECT 1 FROM students s WHERE s.id = student_id)) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_school', t);
  END LOOP;
END
$$;

-- Students: everyone with students.view; class teachers (students.view.own_streams) only their
-- own streams. Writes stay inside the school; the app checks students.edit / import.run.
CREATE POLICY students_select ON students FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('students.view'))
      OR (
        (SELECT app_has_permission('students.view.own_streams'))
        AND stream_id IN (SELECT unnest(app_my_stream_ids()))
      )
    )
  );
CREATE POLICY students_insert ON students FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()));
CREATE POLICY students_update ON students FOR UPDATE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('students.view')))
  WITH CHECK (school_id = (SELECT app_current_school()));

-- Medical notes: only with students.medical.view, for reading and writing.
CREATE POLICY student_medical_permission ON student_medical FOR ALL
  USING (
    school_id = (SELECT app_current_school())
    AND (SELECT app_has_permission('students.medical.view'))
  )
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND (SELECT app_has_permission('students.medical.view'))
  );

-- Pending parent confirmations: only the parent themself. Written by app_upsert_guardian_link().
CREATE POLICY parent_link_confirmations_self ON parent_link_confirmations FOR SELECT
  USING (user_id = (SELECT app_user_id()));

-- Users: also visible to a school when they are a guardian of one of its (visible) students.
DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (
    id = (SELECT app_user_id())
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.school_id = (SELECT app_current_school())
    )
    OR EXISTS (
      SELECT 1 FROM guardian_links g
      WHERE g.user_id = users.id AND g.school_id = (SELECT app_current_school())
    )
  );

-- ---------------------------------------------------------------------------
-- Append-only and immutable rules (also block the owner)
-- ---------------------------------------------------------------------------
CREATE FUNCTION kiota_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER student_status_changes_append_only
  BEFORE UPDATE OR DELETE ON student_status_changes
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();

CREATE TRIGGER students_never_deleted
  BEFORE DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();

-- Once the fees module posts an opening balance it can never change.
CREATE FUNCTION opening_balances_posted_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.posted THEN
    RAISE EXCEPTION 'posted opening balances cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER opening_balances_frozen
  BEFORE UPDATE OR DELETE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION opening_balances_posted_frozen();
