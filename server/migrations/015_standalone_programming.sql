ALTER TABLE ticket_programming
  ALTER COLUMN ticket_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS standalone_location VARCHAR(500) NOT NULL DEFAULT '';
