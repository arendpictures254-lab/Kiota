-- DropForeignKey
ALTER TABLE "school_settings" DROP CONSTRAINT "school_settings_school";

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "card_address" TEXT,
ADD COLUMN     "card_email" TEXT,
ADD COLUMN     "card_phone" TEXT;

-- AddForeignKey
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Written by hand.
-- ===========================================================================

-- Student ID cards are signed with the school's key (the same Ed25519 key as gate passes, but a
-- different token format: KC1, never accepted as a pass). Whoever prints cards may read it and,
-- for a school's first card, create it.
DROP POLICY leaveout_pass_keys_select ON leaveout_pass_keys;
DROP POLICY leaveout_pass_keys_insert ON leaveout_pass_keys;
CREATE POLICY leaveout_pass_keys_select ON leaveout_pass_keys FOR SELECT
  USING (
    school_id = (SELECT app_current_school())
    AND (
      (SELECT app_has_permission('leaveout.approve'))
      OR (SELECT app_has_permission('gate.scan'))
      OR (SELECT app_has_permission('boarding.manage'))
      OR (SELECT app_has_permission('idcards.print'))
    )
  );
CREATE POLICY leaveout_pass_keys_insert ON leaveout_pass_keys FOR INSERT
  WITH CHECK (
    school_id = (SELECT app_current_school())
    AND ((SELECT app_has_permission('leaveout.approve')) OR (SELECT app_has_permission('idcards.print')))
  );

-- The child's attendance in the parent portal (when the school switches the "attendance" module
-- on): one row per register in the last 120 days, from the parent's own link.
CREATE FUNCTION app_parent_attendance(p_link uuid)
RETURNS TABLE (date date, session text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL
     OR NOT EXISTS (SELECT 1 FROM schools sc WHERE sc.id = v.school_id AND 'attendance' = ANY (sc.modules)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.date, se.name, m.status
  FROM attendance_marks m
  JOIN attendance_registers r ON r.id = m.register_id
  JOIN attendance_sessions se ON se.id = r.session_id
  WHERE m.student_id = v.student_id AND m.school_id = v.school_id
    AND m.date >= (now() AT TIME ZONE 'Africa/Nairobi')::date - 120
  ORDER BY m.date, se.position;
END
$$;
REVOKE ALL ON FUNCTION app_parent_attendance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_parent_attendance(uuid) TO kiota_app;
