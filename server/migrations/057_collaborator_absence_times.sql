ALTER TABLE collaborator_absences
  ADD COLUMN IF NOT EXISTS start_time VARCHAR(5),
  ADD COLUMN IF NOT EXISTS end_time VARCHAR(5);

