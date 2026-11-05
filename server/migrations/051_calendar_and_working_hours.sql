-- Migration 051: Calendar holidays, working Saturdays (compensations) and working hours
CREATE TABLE IF NOT EXISTS work_calendar (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('holiday', 'work_saturday')),
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_work_calendar_date ON work_calendar (date);
CREATE INDEX IF NOT EXISTS idx_work_calendar_type ON work_calendar (type);

-- Default working hours: Mon-Thu 08:00-18:00, Fri 08:00-17:00, Sat 08:00-18:00
INSERT INTO application_settings (setting_key, setting_value)
VALUES ('working_hours', '{
  "monday_thursday": { "start": "08:00", "end": "18:00" },
  "friday": { "start": "08:00", "end": "17:00" },
  "work_saturday": { "start": "08:00", "end": "18:00" }
}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

