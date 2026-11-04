-- School walls: the app role, row-level security policies and append-only audit log.
--
-- The app connects as `kiota_app`: not the table owner, not a superuser, no BYPASSRLS,
-- so every policy below always applies to it. Migrations and seeds run as the owner.
--
-- Each request sets, inside a transaction:
--   set_config('app.user_id',   '<uuid>', true)
--   set_config('app.school_id', '<uuid>', true)
-- app_current_school() only returns the school if that user really is an active member
-- (or an Arend admin while the school's support access is on). Anything else sees nothing.
--
-- The functions marked SECURITY DEFINER run as the migration owner, which must be a
-- superuser or have BYPASSRLS (otherwise the policies would call themselves).

-- ---------------------------------------------------------------------------
-- App role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kiota_app') THEN
    -- Password and LOGIN are set outside migrations (see prisma/seed.ts for development).
    CREATE ROLE kiota_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO kiota_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  schools, users, otp_codes, sessions, memberships, roles, role_permissions,
  membership_roles, permission_grants
TO kiota_app;

-- The permission catalogue is maintained by migrations and seeds only.
GRANT SELECT ON permissions TO kiota_app;

-- Audit log: append-only for the app.
GRANT SELECT, INSERT ON audit_logs TO kiota_app;

-- ---------------------------------------------------------------------------
-- Context helpers
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_requested_school_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.school_id', true), '')::uuid $$;

CREATE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((SELECT u.is_platform_admin FROM users u WHERE u.id = app_user_id()), false)
$$;

-- The school this transaction may see, or NULL. Verified against memberships, so a
-- wrong or forged app.school_id still sees nothing.
CREATE FUNCTION app_current_school() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id
  FROM schools s
  WHERE s.id = app_requested_school_id()
    AND s.status <> 'suspended'
    AND (
      EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.school_id = s.id AND m.user_id = app_user_id() AND m.status = 'active'
      )
      OR (s.support_access_until > now() AND app_is_platform_admin())
    )
$$;

-- ---------------------------------------------------------------------------
-- Narrow privileged operations (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

-- School picker: the signed-in user's own schools and role names.
CREATE FUNCTION app_my_schools()
RETURNS TABLE (school_id uuid, name text, short_name text, role_names text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.name, s.short_name::text,
         coalesce(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}')
  FROM memberships m
  JOIN schools s ON s.id = m.school_id
  LEFT JOIN membership_roles mr ON mr.membership_id = m.id
  LEFT JOIN roles r ON r.id = mr.role_id
  WHERE m.user_id = app_user_id() AND m.status = 'active' AND s.status <> 'suspended'
  GROUP BY s.id, s.name, s.short_name
  ORDER BY s.name
$$;

-- Sign-in: the user id for a verified phone number. Called only after the OTP check.
CREATE FUNCTION app_auth_user_id(p_phone text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT u.id FROM users u WHERE u.phone = p_phone $$;

-- Is this phone allowed to sign in? (A user with an active membership, or an Arend admin.)
CREATE FUNCTION app_phone_can_sign_in(p_phone text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.phone = p_phone
      AND (
        u.is_platform_admin
        OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.status = 'active')
      )
  )
$$;

-- Find or create the platform identity for a phone number. Never reveals or changes an
-- existing user's name. Only callable from a verified school context or by an Arend admin.
CREATE FUNCTION app_ensure_user(p_phone text, p_name text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF app_current_school() IS NULL AND NOT app_is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO users (phone, name, updated_at) VALUES (p_phone, p_name, now())
  ON CONFLICT (phone) DO NOTHING;
  SELECT id INTO v_id FROM users WHERE phone = p_phone;
  RETURN v_id;
END
$$;

-- Arend admin: create a school and make the given person its Director.
CREATE FUNCTION app_create_school(
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

  INSERT INTO schools (name, short_name, county, levels_offered, updated_at)
  VALUES (p_name, p_short_name, p_county, p_levels, now())
  RETURNING id INTO v_school;

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

REVOKE ALL ON FUNCTION
  app_user_id(), app_requested_school_id(), app_is_platform_admin(), app_current_school(),
  app_my_schools(), app_auth_user_id(text), app_phone_can_sign_in(text),
  app_ensure_user(text, text), app_create_school(text, text, text, text[], text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app_user_id(), app_requested_school_id(), app_is_platform_admin(), app_current_school(),
  app_my_schools(), app_auth_user_id(text), app_phone_can_sign_in(text),
  app_ensure_user(text, text), app_create_school(text, text, text, text[], text, text, text)
TO kiota_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
ALTER TABLE schools            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

ALTER TABLE schools            FORCE ROW LEVEL SECURITY;
ALTER TABLE users              FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships        FORCE ROW LEVEL SECURITY;
ALTER TABLE roles              FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions   FORCE ROW LEVEL SECURITY;
ALTER TABLE membership_roles   FORCE ROW LEVEL SECURITY;
ALTER TABLE permission_grants  FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         FORCE ROW LEVEL SECURITY;

-- schools: your own school; Arend admins can list schools (name and status only matter
-- there; no school data lives on this row). Created only through app_create_school().
CREATE POLICY schools_select ON schools FOR SELECT
  USING (id = (SELECT app_current_school()) OR (SELECT app_is_platform_admin()));
CREATE POLICY schools_update ON schools FOR UPDATE
  USING (id = (SELECT app_current_school()))
  WITH CHECK (id = (SELECT app_current_school()));

-- users: yourself, and members of the school you are in. Created via app_ensure_user().
CREATE POLICY users_select ON users FOR SELECT
  USING (
    id = (SELECT app_user_id())
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.school_id = (SELECT app_current_school())
    )
  );
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = (SELECT app_user_id()))
  WITH CHECK (id = (SELECT app_user_id()));

-- School-owned tables: only the current school.
CREATE POLICY memberships_school ON memberships FOR ALL
  USING (school_id = (SELECT app_current_school()))
  WITH CHECK (school_id = (SELECT app_current_school()));

CREATE POLICY permission_grants_school ON permission_grants FOR ALL
  USING (school_id = (SELECT app_current_school()))
  WITH CHECK (school_id = (SELECT app_current_school()));

-- A membership may only be given a role it can see: built-in or its own school's.
CREATE POLICY membership_roles_school ON membership_roles FOR ALL
  USING (school_id = (SELECT app_current_school()))
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id)
  );

-- Roles: built-in roles (school_id NULL) are readable by everyone; custom roles by their
-- own school. Built-in roles can never be changed by the app (NULL never equals a school).
CREATE POLICY roles_select ON roles FOR SELECT
  USING (school_id IS NULL OR school_id = (SELECT app_current_school()));
CREATE POLICY roles_write ON roles FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()));
CREATE POLICY roles_update ON roles FOR UPDATE
  USING (school_id = (SELECT app_current_school()))
  WITH CHECK (school_id = (SELECT app_current_school()));
CREATE POLICY roles_delete ON roles FOR DELETE
  USING (school_id = (SELECT app_current_school()));

CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (school_id IS NULL OR school_id = (SELECT app_current_school()));
CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT
  WITH CHECK (school_id = (SELECT app_current_school()));
CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE
  USING (school_id = (SELECT app_current_school()));

-- Audit log: read and append within your school; platform events (school_id NULL) are
-- appended by the acting user and readable by Arend admins.
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    OR (school_id IS NULL AND (SELECT app_is_platform_admin()))
  );
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    OR (school_id IS NULL AND actor_id = (SELECT app_user_id()))
  );

-- ---------------------------------------------------------------------------
-- Append-only audit log (also blocks the owner)
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
