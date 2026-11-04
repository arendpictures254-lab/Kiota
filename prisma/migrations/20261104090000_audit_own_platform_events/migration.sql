-- Let a user read back their own platform-level audit entries (e.g. their sign-ins).
-- Needed because INSERT ... RETURNING also applies the SELECT policy.
DROP POLICY audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    OR (school_id IS NULL AND actor_id = (SELECT app_user_id()))
    OR (school_id IS NULL AND (SELECT app_is_platform_admin()))
  );
