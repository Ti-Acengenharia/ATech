ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS source_creator_name VARCHAR(240) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cv_responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cv_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_protocol_normalized_unique
  ON tickets (upper(regexp_replace(btrim(protocol), '[[:space:]]+', '', 'g')))
  WHERE btrim(protocol) <> '';

CREATE TABLE IF NOT EXISTS ticket_tags (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3478a8',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_tags_name_unique
  ON ticket_tags (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS ticket_tag_assignments (
  ticket_id BIGINT NOT NULL REFERENCES tickets(source_id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES ticket_tags(id) ON DELETE CASCADE,
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ticket_tag_assignments_tag_index
  ON ticket_tag_assignments (tag_id, ticket_id);
