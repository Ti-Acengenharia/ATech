-- Migration 048: Session timeout setting and application settings initialization
CREATE TABLE IF NOT EXISTS application_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);

-- Default session timeout: 60 minutes (1 hour)
INSERT INTO application_settings (setting_key, setting_value)
VALUES ('session_timeout_minutes', '60'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

