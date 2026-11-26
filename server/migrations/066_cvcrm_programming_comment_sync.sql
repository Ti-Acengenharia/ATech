ALTER TABLE ticket_programming
  ADD COLUMN IF NOT EXISTS cvcrm_synced_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS cvcrm_synced_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS cvcrm_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ticket_programming_cvcrm_sync_index
  ON ticket_programming (ticket_id, cvcrm_synced_hash)
  WHERE ticket_id IS NOT NULL;
