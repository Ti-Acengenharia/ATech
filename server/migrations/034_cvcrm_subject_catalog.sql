CREATE TABLE IF NOT EXISTS cvcrm_subject_catalog (
  source_subject_id INTEGER PRIMARY KEY CHECK (source_subject_id > 0),
  name VARCHAR(240) NOT NULL CHECK (length(btrim(name)) > 0),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
