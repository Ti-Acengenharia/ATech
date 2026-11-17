CREATE TABLE IF NOT EXISTS sienge_api_daily_usage (
  usage_date DATE PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
