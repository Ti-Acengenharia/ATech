ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS cost_center VARCHAR(40) NOT NULL DEFAULT 'assistencia_tecnica';

ALTER TABLE collaborators
  DROP CONSTRAINT IF EXISTS collaborators_cost_center_check;

ALTER TABLE collaborators
  ADD CONSTRAINT collaborators_cost_center_check
  CHECK (cost_center IN ('assistencia_tecnica', 'pos_obra'));

ALTER TABLE ticket_programming
  DROP CONSTRAINT IF EXISTS ticket_programming_type_check;

ALTER TABLE ticket_programming
  ADD CONSTRAINT ticket_programming_type_check
  CHECK (programming_type IN ('general', 'foreman', 'post_work'));

ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS schedule_group_id UUID;

CREATE INDEX IF NOT EXISTS ticket_programming_schedule_group_idx
  ON ticket_programming (schedule_group_id)
  WHERE schedule_group_id IS NOT NULL;
