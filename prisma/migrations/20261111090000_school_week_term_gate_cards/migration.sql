-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "saturday_level_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "school_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];


-- ===========================================================================
-- Written by hand.
-- ===========================================================================

ALTER TABLE school_settings ADD CONSTRAINT school_settings_school_days
  CHECK (school_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6] AND cardinality(school_days) >= 1);

-- The current term of a parent's child's school (confirmed links only, through the parent's own
-- link): the portal shows attendance "this term". Nothing when no term is running.
CREATE FUNCTION app_parent_current_term(p_link uuid)
RETURNS TABLE (name text, academic_year text, start_date date, end_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.name, y.name, t.start_date, t.end_date
  FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
  WHERE t.school_id = v.school_id AND t.start_date <= v_today AND t.end_date >= v_today
  ORDER BY t.start_date DESC
  LIMIT 1;
END
$$;

-- The child's registers: now long enough to cover a whole term.
CREATE OR REPLACE FUNCTION app_parent_attendance(p_link uuid)
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
    AND m.date >= (now() AT TIME ZONE 'Africa/Nairobi')::date - 200
  ORDER BY m.date, se.position;
END
$$;

-- The gate phone's offline copy of the school's ID cards: who each card belongs to (never more),
-- and which cards were replaced. Only for gate.scan; the guard still never reads students.
CREATE FUNCTION app_gate_cards()
RETURNS TABLE (
  card_id uuid, nonce text, live boolean, valid_until_year int, student_id uuid,
  first_name text, last_name text, admission_number text, class_label text, boarder boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT app_has_permission('gate.scan') AND NOT app_has_permission('boarding.manage') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id, c.nonce, c.revoked_at IS NULL, c.valid_until_year, s.id,
         CASE WHEN c.revoked_at IS NULL THEN s.first_name END,
         CASE WHEN c.revoked_at IS NULL THEN s.last_name END,
         CASE WHEN c.revoked_at IS NULL THEN s.admission_number END,
         CASE WHEN c.revoked_at IS NULL THEN cl.name || coalesce(' ' || st.name, '') END,
         CASE WHEN c.revoked_at IS NULL THEN s.boarder END
  FROM student_cards c
  JOIN students s ON s.id = c.student_id AND s.school_id = c.school_id AND s.status = 'active'
  JOIN classes cl ON cl.id = s.class_id
  LEFT JOIN streams st ON st.id = s.stream_id
  WHERE c.school_id = app_current_school();
END
$$;

REVOKE ALL ON FUNCTION app_parent_current_term(uuid), app_gate_cards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_parent_current_term(uuid), app_gate_cards() TO kiota_app;
