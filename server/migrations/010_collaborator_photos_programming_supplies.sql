ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS photo_content_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS photo_content BYTEA;

ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS enterprise VARCHAR(240) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS block VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS common_area_location VARCHAR(240) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS materials TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS equipment TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}';

UPDATE ticket_programming p
SET enterprise = t.enterprise,
    block = t.block,
    unit = t.unit
FROM tickets t
WHERE p.ticket_id = t.source_id
  AND p.enterprise = ''
  AND p.block = ''
  AND p.unit = '';
