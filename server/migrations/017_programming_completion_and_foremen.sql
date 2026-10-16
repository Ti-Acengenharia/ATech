ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS programming_type VARCHAR(20) NOT NULL DEFAULT 'general';

UPDATE ticket_programming p
SET programming_type = 'foreman'
FROM collaborators c
WHERE c.id = p.collaborator_id
  AND c.role = 'encarregado'
  AND p.programming_type = 'general';

ALTER TABLE ticket_programming
  DROP CONSTRAINT IF EXISTS ticket_programming_type_check;

ALTER TABLE ticket_programming
  ADD CONSTRAINT ticket_programming_type_check
  CHECK (programming_type IN ('general', 'foreman'));
