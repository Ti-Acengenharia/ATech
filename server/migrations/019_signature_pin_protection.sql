ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signature_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS signature_pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signature_pin_locked_until TIMESTAMPTZ;
