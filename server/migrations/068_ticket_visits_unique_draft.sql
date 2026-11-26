DELETE FROM ticket_visits a
USING ticket_visits b
WHERE a.ticket_id = b.ticket_id
  AND a.status = 'draft'
  AND b.status = 'draft'
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.id < b.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS ticket_visits_one_draft_per_ticket_idx
  ON ticket_visits (ticket_id)
  WHERE status = 'draft';
