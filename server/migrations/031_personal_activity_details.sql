ALTER TABLE personal_activities
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS personal_activity_comments (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES personal_activities(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 6000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_activity_comments_activity_index
  ON personal_activity_comments (activity_id, created_at, id);

CREATE TABLE IF NOT EXISTS personal_activity_attachments (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES personal_activities(id) ON DELETE CASCADE,
  uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(150) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_activity_attachments_activity_index
  ON personal_activity_attachments (activity_id, created_at, id);
