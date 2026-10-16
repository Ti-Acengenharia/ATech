CREATE TABLE IF NOT EXISTS application_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);

INSERT INTO application_settings (setting_key, setting_value)
VALUES ('programming_hidden_roles', '[]'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;
