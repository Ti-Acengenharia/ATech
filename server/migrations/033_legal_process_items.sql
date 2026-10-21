CREATE TABLE IF NOT EXISTS legal_process_items (
  id BIGSERIAL PRIMARY KEY,
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_process_items_parent_index
  ON legal_process_items (process_id, position, id);
