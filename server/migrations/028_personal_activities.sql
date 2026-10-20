CREATE TABLE IF NOT EXISTS personal_activity_columns (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE TABLE IF NOT EXISTS personal_activities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  column_id BIGINT NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, column_id)
    REFERENCES personal_activity_columns(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS personal_activity_columns_owner_position_index
  ON personal_activity_columns (user_id, position, id);

CREATE INDEX IF NOT EXISTS personal_activities_owner_column_index
  ON personal_activities (user_id, column_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_personal_activity_permissions (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_view_others BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO user_page_access (user_id, page_key)
SELECT id, 'personal-activities'
FROM users
WHERE role = 'member'
ON CONFLICT (user_id, page_key) DO NOTHING;
