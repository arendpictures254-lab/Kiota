-- 1. Schools never read platform-level names.
--    A user's name on `users` was typed by whichever school (or Arend admin) created them first.
--    Each school now keeps its own name: memberships.display_name for staff (guardian_links.name
--    already exists for guardians). The app role can no longer read users.name or users.email at
--    all; a user reads their own record through app_me().
-- 2. Demo requests from the public website (platform level).

-- ---------------------------------------------------------------------------
-- Staff display names, per school
-- ---------------------------------------------------------------------------
ALTER TABLE "memberships" ADD COLUMN "display_name" TEXT;
UPDATE memberships m SET display_name = u.name FROM users u WHERE u.id = m.user_id;
ALTER TABLE "memberships" ALTER COLUMN "display_name" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Column-level privileges on users: no name, no email, no updates
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON users FROM kiota_app;
GRANT SELECT (id, phone, is_platform_admin, created_at) ON users TO kiota_app;
DROP POLICY users_update_self ON users;

-- The signed-in user's own record (including the name they are known by on the platform).
CREATE FUNCTION app_me()
RETURNS TABLE (id uuid, name text, phone text, is_platform_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id, u.name, u.phone, u.is_platform_admin FROM users u WHERE u.id = app_user_id()
$$;
REVOKE ALL ON FUNCTION app_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_me() TO kiota_app;

-- app_create_school: the Director's membership carries the name the admin typed.
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

  INSERT INTO memberships (school_id, user_id, display_name, updated_at)
  VALUES (v_school, v_director, p_director_name, now())
  RETURNING id INTO v_membership;

  SELECT id INTO v_role FROM roles WHERE key = 'director';
  INSERT INTO membership_roles (school_id, membership_id, role_id)
  VALUES (v_school, v_membership, v_role);

  INSERT INTO audit_logs (school_id, actor_id, action, target_type, target_id, after, ip)
  VALUES (
    v_school, app_user_id(), 'school.create', 'school', v_school::text,
    jsonb_build_object(
      'name', p_name, 'shortName', p_short_name, 'county', p_county,
      'levelsOffered', p_levels, 'directorUserId', v_director, 'directorName', p_director_name
    ),
    p_ip
  );

  RETURN v_school;
END
$$;

-- ---------------------------------------------------------------------------
-- Demo requests (public website)
-- ---------------------------------------------------------------------------
CREATE TYPE "DemoRequestStatus" AS ENUM ('new', 'contacted', 'demo_booked', 'won', 'lost');

CREATE TABLE "demo_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_name" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "student_count" INTEGER NOT NULL,
    "school_type" TEXT NOT NULL,
    "message" TEXT,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'new',
    "ip_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "demo_requests_ip_hash_created_at_idx" ON "demo_requests"("ip_hash", "created_at");

ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON demo_requests TO kiota_app;
CREATE POLICY demo_requests_admin_select ON demo_requests FOR SELECT
  USING ((SELECT app_is_platform_admin()));
CREATE POLICY demo_requests_admin_update ON demo_requests FOR UPDATE
  USING ((SELECT app_is_platform_admin()))
  WITH CHECK ((SELECT app_is_platform_admin()));

-- Anyone may submit; at most 3 per sender per hour and 30 per hour in total.
CREATE FUNCTION app_submit_demo_request(
  p_school_name text, p_county text, p_contact_name text, p_contact_role text, p_phone text,
  p_email text, p_student_count int, p_school_type text, p_message text, p_ip_hash text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF (SELECT count(*) FROM demo_requests
      WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM demo_requests WHERE created_at > now() - interval '1 hour') >= 30
  THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO demo_requests (
    school_name, county, contact_name, contact_role, phone, email, student_count,
    school_type, message, ip_hash, updated_at
  ) VALUES (
    p_school_name, p_county, p_contact_name, p_contact_role, p_phone, p_email, p_student_count,
    p_school_type, p_message, p_ip_hash, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app_submit_demo_request(text, text, text, text, text, text, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_demo_request(text, text, text, text, text, text, int, text, text, text) TO kiota_app;
