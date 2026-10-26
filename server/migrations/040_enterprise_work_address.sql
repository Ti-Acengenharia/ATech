ALTER TABLE enterprise_information
  ADD COLUMN IF NOT EXISTS work_address TEXT NOT NULL DEFAULT '';
