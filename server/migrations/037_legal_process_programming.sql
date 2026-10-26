ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS legal_process_id BIGINT REFERENCES legal_processes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ticket_programming_legal_process_index
  ON ticket_programming (legal_process_id, starts_at)
  WHERE legal_process_id IS NOT NULL;

ALTER TABLE ticket_programming
  DROP CONSTRAINT IF EXISTS ticket_programming_single_association_check;

ALTER TABLE ticket_programming
  ADD CONSTRAINT ticket_programming_single_association_check
  CHECK (num_nonnulls(ticket_id, legal_process_id) <= 1);
