CREATE TABLE IF NOT EXISTS legal_process_conclusion_history (
  id BIGSERIAL PRIMARY KEY,
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  result VARCHAR(30) NOT NULL CHECK (result IN (
    'full_win',
    'partial_win',
    'full_loss',
    'partial_loss'
  )),
  summary TEXT NOT NULL,
  concluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluded_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS legal_process_conclusion_history_process_index
  ON legal_process_conclusion_history (process_id, concluded_at DESC, id DESC);

INSERT INTO legal_process_conclusion_history (process_id, result, summary, concluded_at, concluded_by)
SELECT id, conclusion_result, conclusion_summary, updated_at, created_by
FROM legal_processes
WHERE conclusion_result IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM legal_process_conclusion_history history
    WHERE history.process_id = legal_processes.id
      AND history.result = legal_processes.conclusion_result
      AND history.summary = legal_processes.conclusion_summary
  );
