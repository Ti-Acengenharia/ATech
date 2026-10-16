ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS source_subject_id INTEGER,
  ADD COLUMN IF NOT EXISTS source_subsubject_id INTEGER;

CREATE INDEX IF NOT EXISTS tickets_subsubject_source_index
  ON tickets (source_subject_id, source_subsubject_id);

CREATE TABLE IF NOT EXISTS warranty_subsubjects (
  source_subsubject_id INTEGER PRIMARY KEY,
  source_subject_id INTEGER NOT NULL,
  name VARCHAR(240) NOT NULL,
  warranty_years SMALLINT CHECK (warranty_years IS NULL OR warranty_years BETWEEN 1 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warranty_subsubjects_name_index
  ON warranty_subsubjects (lower(name));
