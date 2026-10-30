ALTER TABLE legal_processes
  ADD COLUMN IF NOT EXISTS conclusion_result VARCHAR(30),
  ADD COLUMN IF NOT EXISTS conclusion_summary TEXT NOT NULL DEFAULT '';

ALTER TABLE legal_processes
  DROP CONSTRAINT IF EXISTS legal_processes_conclusion_result_check;

ALTER TABLE legal_processes
  ADD CONSTRAINT legal_processes_conclusion_result_check
  CHECK (conclusion_result IS NULL OR conclusion_result IN (
    'full_win',
    'partial_win',
    'full_loss',
    'partial_loss'
  ));
