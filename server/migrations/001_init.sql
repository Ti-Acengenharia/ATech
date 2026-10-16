CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'member')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
  password_hash TEXT,
  invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT admin_must_be_active CHECK (role <> 'admin' OR status = 'active'),
  CONSTRAINT admin_requires_password CHECK (role <> 'admin' OR password_hash IS NOT NULL),
  CONSTRAINT member_has_no_password CHECK (role <> 'member' OR password_hash IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS only_one_atech_admin ON users (role) WHERE role = 'admin';
CREATE INDEX IF NOT EXISTS users_status_index ON users (status);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_index ON user_sessions (expire);