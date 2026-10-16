CREATE TABLE IF NOT EXISTS ticket_workflow_stages (
  source_status_id INTEGER PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  position INTEGER NOT NULL,
  background_color VARCHAR(7),
  text_color VARCHAR(7),
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  source_id BIGINT PRIMARY KEY,
  reference VARCHAR(100) NOT NULL UNIQUE,
  protocol VARCHAR(100) NOT NULL DEFAULT '',
  source_status_id INTEGER,
  source_status_name VARCHAR(160) NOT NULL DEFAULT 'Sem situação',
  source_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_modified_at TIMESTAMP,
  opened_at TIMESTAMP,
  customer_name VARCHAR(240) NOT NULL DEFAULT '',
  customer_phone_ciphertext TEXT,
  subject VARCHAR(240) NOT NULL DEFAULT '',
  subsubject VARCHAR(240) NOT NULL DEFAULT '',
  enterprise VARCHAR(240) NOT NULL DEFAULT '',
  block VARCHAR(120) NOT NULL DEFAULT '',
  unit VARCHAR(120) NOT NULL DEFAULT '',
  priority VARCHAR(80) NOT NULL DEFAULT '',
  local_due_at TIMESTAMPTZ,
  estimated_cost NUMERIC(14, 2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  actual_cost NUMERIC(14, 2) CHECK (actual_cost IS NULL OR actual_cost >= 0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_active_stage_index
  ON tickets (source_active, source_status_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS tickets_protocol_index ON tickets (protocol);
CREATE INDEX IF NOT EXISTS tickets_enterprise_index ON tickets (enterprise);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(source_id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 6000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_comments_order_index
  ON ticket_comments (ticket_id, created_at, id);

CREATE TABLE IF NOT EXISTS ticket_comment_mentions (
  comment_id BIGINT NOT NULL REFERENCES ticket_comments(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS ticket_subtasks (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(source_id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_subtasks_ticket_index ON ticket_subtasks (ticket_id, id);

CREATE TABLE IF NOT EXISTS ticket_programming (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(source_id) ON DELETE CASCADE,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id),
  activity_description TEXT NOT NULL CHECK (length(trim(activity_description)) BETWEEN 1 AND 3000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_programming_valid_range CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS ticket_programming_collaborator_time_index
  ON ticket_programming (collaborator_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS ticket_programming_ticket_index ON ticket_programming (ticket_id, starts_at);

CREATE TABLE IF NOT EXISTS ticket_sync_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_success BOOLEAN,
  imported_count INTEGER NOT NULL DEFAULT 0,
  error_message VARCHAR(500),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);