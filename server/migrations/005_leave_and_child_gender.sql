ALTER TABLE collaborator_children
  ADD COLUMN IF NOT EXISTS gender_ciphertext TEXT;

ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS is_on_leave BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS leave_start_date_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS expected_return_date_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS leave_reason_ciphertext TEXT;