CREATE TABLE IF NOT EXISTS user_page_access (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key VARCHAR(40) NOT NULL,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_key)
);

INSERT INTO user_page_access (user_id, page_key)
SELECT u.id, page_key
FROM users u
CROSS JOIN (VALUES ('home'), ('tickets'), ('schedule'), ('collaborators'), ('information')) AS defaults(page_key)
WHERE u.role = 'member'
ON CONFLICT (user_id, page_key) DO NOTHING;

INSERT INTO user_page_access (user_id, page_key)
SELECT user_id, 'legal-processes'
FROM legal_process_access
ON CONFLICT (user_id, page_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS user_page_access_page_index
  ON user_page_access (page_key, user_id);
