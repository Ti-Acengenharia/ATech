ALTER TABLE legal_processes
  ADD COLUMN IF NOT EXISTS enterprise_key TEXT;

CREATE INDEX IF NOT EXISTS legal_processes_enterprise_index
  ON legal_processes (enterprise_key);
