ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS birth_date_ciphertext TEXT;