-- Performance: the policy helper functions were LANGUAGE sql + SECURITY DEFINER, which Postgres
-- re-plans on every call (about 3 ms each, so ~18 ms per student query). PL/pgSQL caches its
-- query plans for the session, so the same checks cost a fraction of a millisecond.
-- Behaviour is unchanged: same arguments, same results, same security.

CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v boolean;
BEGIN
  SELECT u.is_platform_admin INTO v FROM users u WHERE u.id = app_user_id();
  RETURN coalesce(v, false);
END
$$;

CREATE OR REPLACE FUNCTION app_current_school() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school uuid := app_requested_school_id();
  v_user uuid := app_user_id();
  v_ok boolean;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT
    s.status <> 'suspended'
    AND (
      EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.school_id = s.id AND m.user_id = v_user AND m.status = 'active'
      )
      OR (s.support_access_until > now() AND app_is_platform_admin())
    )
  INTO v_ok
  FROM schools s WHERE s.id = v_school;
  RETURN CASE WHEN v_ok THEN v_school ELSE NULL END;
END
$$;

CREATE OR REPLACE FUNCTION app_has_permission(p text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school uuid := app_current_school();
  v_user uuid := app_user_id();
  v_membership uuid;
BEGIN
  IF v_school IS NULL THEN
    RETURN false;
  END IF;
  SELECT m.id INTO v_membership FROM memberships m
  WHERE m.user_id = v_user AND m.school_id = v_school AND m.status = 'active';
  IF v_membership IS NULL THEN
    -- Arend admins with support access may view students, never medical records.
    RETURN p = 'students.view' AND app_is_platform_admin();
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM membership_roles mr
    JOIN role_permissions rp ON rp.role_id = mr.role_id
    WHERE mr.membership_id = v_membership AND rp.permission_key = p
  ) OR EXISTS (
    SELECT 1 FROM permission_grants g
    WHERE g.membership_id = v_membership AND g.permission_key = p
  );
END
$$;

CREATE OR REPLACE FUNCTION app_my_stream_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v uuid[];
BEGIN
  SELECT coalesce(array_agg(s.id), '{}') INTO v
  FROM streams s
  JOIN memberships m ON m.id = s.class_teacher_membership_id
  WHERE s.school_id = app_current_school() AND m.user_id = app_user_id() AND m.status = 'active';
  RETURN v;
END
$$;

-- Bulk guardian linking for the import: one round trip for every row. Each row goes through
-- app_upsert_guardian_link(), so the same rules (identity by phone, pending confirmation at a
-- second school, permission checks) apply.
CREATE FUNCTION app_upsert_guardian_links(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r jsonb;
  n integer := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    PERFORM app_upsert_guardian_link(
      (r->>'studentId')::uuid, r->>'phone', r->>'name', r->>'relationship', r->>'language',
      (r->>'receivesFees')::boolean, (r->>'receivesAcademics')::boolean,
      (r->>'receivesBoarding')::boolean, (r->>'authorisedToCollect')::boolean
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION app_upsert_guardian_links(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_upsert_guardian_links(jsonb) TO kiota_app;
