CREATE TABLE IF NOT EXISTS legal_process_access (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS legal_process_statuses (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  position INTEGER NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3478a8',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_process_statuses_name_index
  ON legal_process_statuses (lower(name));

INSERT INTO legal_process_statuses (name, position, color)
SELECT defaults.name, defaults.position, defaults.color
FROM (VALUES
  ('Novo', 0, '#3478a8'),
  ('Em andamento', 1, '#a67824'),
  ('Aguardando', 2, '#7557a5'),
  ('Concluído', 3, '#43805b')
) AS defaults(name, position, color)
WHERE NOT EXISTS (SELECT 1 FROM legal_process_statuses);

CREATE TABLE IF NOT EXISTS legal_processes (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(240) NOT NULL,
  status_id BIGINT NOT NULL REFERENCES legal_process_statuses(id) ON DELETE RESTRICT,
  start_date DATE,
  end_date DATE,
  description TEXT NOT NULL DEFAULT '',
  case_value NUMERIC(14, 2) CHECK (case_value IS NULL OR case_value >= 0),
  claimant VARCHAR(240) NOT NULL DEFAULT '',
  drive_url TEXT NOT NULL DEFAULT '',
  notebook_url TEXT NOT NULL DEFAULT '',
  distribution_date DATE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX IF NOT EXISTS legal_processes_status_index ON legal_processes (status_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS legal_processes_demo_index ON legal_processes (is_demo) WHERE is_demo;

CREATE TABLE IF NOT EXISTS legal_process_assignees (
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (process_id, user_id)
);
CREATE INDEX IF NOT EXISTS legal_process_assignees_user_index ON legal_process_assignees (user_id, process_id);

CREATE TABLE IF NOT EXISTS legal_process_children (
  id BIGSERIAL PRIMARY KEY,
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  title VARCHAR(240) NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_process_children_parent_index ON legal_process_children (process_id, position, id);

CREATE TABLE IF NOT EXISTS legal_process_payments (
  id BIGSERIAL PRIMARY KEY,
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  description VARCHAR(500) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  due_date DATE,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_process_payments_parent_index ON legal_process_payments (process_id, due_date, id);

CREATE TABLE IF NOT EXISTS legal_process_payment_attachments (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES legal_process_payments(id) ON DELETE CASCADE,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(150) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_process_payment_attachments_parent_index
  ON legal_process_payment_attachments (payment_id, created_at, id);
