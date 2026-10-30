CREATE TABLE IF NOT EXISTS legal_process_tags (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3478a8',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT legal_process_tags_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_process_tags_name_unique
  ON legal_process_tags (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS legal_process_tag_assignments (
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES legal_process_tags(id) ON DELETE CASCADE,
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (process_id, tag_id)
);

CREATE INDEX IF NOT EXISTS legal_process_tag_assignments_tag_index
  ON legal_process_tag_assignments (tag_id, process_id);
