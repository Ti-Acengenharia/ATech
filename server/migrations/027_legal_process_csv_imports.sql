CREATE TABLE IF NOT EXISTS legal_process_csv_imports (
  external_task_id VARCHAR(100) PRIMARY KEY,
  process_id BIGINT NOT NULL UNIQUE REFERENCES legal_processes(id) ON DELETE CASCADE,
  imported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
