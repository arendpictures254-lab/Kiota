-- The hidden automatic-payments user ("system:payments") can never sign in.
CREATE OR REPLACE FUNCTION app_phone_can_sign_in(p_phone text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_phone NOT LIKE 'system:%' AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.phone = p_phone
      AND (
        u.is_platform_admin
        OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.status = 'active')
      )
  )
$$;
