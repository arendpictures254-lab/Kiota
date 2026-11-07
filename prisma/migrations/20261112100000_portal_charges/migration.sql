-- The parent portal also lists one-off charges (uniforms, trips...), so they are not mistaken for
-- arrears from previous terms. Same function, one more field.
CREATE OR REPLACE FUNCTION app_parent_fees(p_link uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v guardian_links;
  r jsonb;
BEGIN
  v := kiota_parent_link(p_link);
  IF v.id IS NULL OR NOT v.receives_fees THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'balanceCents', COALESCE((
      SELECT sum(l.amount_cents) FROM ledger_lines l
      WHERE l.school_id = v.school_id AND l.student_id = v.student_id), 0),
    'voteHeads', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', vh.name, 'balanceCents', t.total)
                       ORDER BY vh.priority NULLS LAST, vh.name)
      FROM (
        SELECT l.vote_head_id, sum(l.amount_cents) AS total FROM ledger_lines l
        WHERE l.school_id = v.school_id AND l.student_id = v.student_id
        GROUP BY l.vote_head_id
      ) t
      LEFT JOIN vote_heads vh ON vh.id = t.vote_head_id
      WHERE t.total <> 0), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'term', tm.name, 'year', ay.name, 'totalCents', i.total_cents,
        'createdAt', i.created_at,
        'installments', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('dueDate', fi.due_date, 'percentBp', fi.percent_bp)
                           ORDER BY fi.due_date)
          FROM fee_installments fi
          WHERE fi.school_id = v.school_id AND fi.fee_structure_id = i.fee_structure_id
        ), '[]'::jsonb)) ORDER BY i.created_at DESC)
      FROM invoices i
      JOIN terms tm ON tm.id = i.term_id
      JOIN academic_years ay ON ay.id = tm.academic_year_id
      WHERE i.school_id = v.school_id AND i.student_id = v.student_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'amountCents', p.amount_cents, 'method', p.method::text,
        'reference', p.reference, 'paidAt', p.paid_at, 'receiptNumber', rc.number,
        'shareToken', rc.share_token, 'reversed', rv.id IS NOT NULL)
        ORDER BY p.paid_at DESC, p.created_at DESC)
      FROM payments p
      LEFT JOIN receipts rc ON rc.payment_id = p.id
      LEFT JOIN reversals rv ON rv.payment_id = p.id
      WHERE p.school_id = v.school_id AND p.student_id = v.student_id), '[]'::jsonb),
    'charges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'description', e.description, 'amountCents', e.amount_cents,
        'createdAt', e.created_at,
        'reversed', EXISTS (SELECT 1 FROM ledger_entries x WHERE x.reverses_entry_id = e.id))
        ORDER BY e.created_at DESC)
      FROM ledger_entries e
      WHERE e.school_id = v.school_id AND e.student_id = v.student_id AND e.type = 'charge'), '[]'::jsonb),
    'mpesa', EXISTS (SELECT 1 FROM mpesa_settings ms WHERE ms.school_id = v.school_id)
  ) INTO r;
  RETURN r;
END
$$;
