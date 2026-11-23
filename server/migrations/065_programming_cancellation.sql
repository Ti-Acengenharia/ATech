ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancellation_reason_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reassigned_to BIGINT REFERENCES collaborators(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by BIGINT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS ticket_programming_cancelled_index
  ON ticket_programming (cancelled);
