DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'legal_process_children'
      AND column_name = 'title'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'legal_process_children'
      AND column_name = 'description'
  ) THEN
    ALTER TABLE legal_process_children RENAME COLUMN title TO description;
  END IF;
END $$;

ALTER TABLE legal_process_children
  ADD COLUMN IF NOT EXISTS process_number VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_id BIGINT REFERENCES legal_process_statuses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS movement_date DATE;

UPDATE legal_process_children
SET status_id = (SELECT id FROM legal_process_statuses ORDER BY position, id LIMIT 1),
    process_number = 'Não informado'
WHERE status_id IS NULL;

ALTER TABLE legal_process_children ALTER COLUMN status_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS legal_process_comments (
  id BIGSERIAL PRIMARY KEY,
  process_id BIGINT NOT NULL REFERENCES legal_processes(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id),
  parent_comment_id BIGINT REFERENCES legal_process_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 6000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_process_comments_order_index
  ON legal_process_comments (process_id, created_at, id);
CREATE INDEX IF NOT EXISTS legal_process_children_status_index
  ON legal_process_children (status_id, process_id);

CREATE TABLE IF NOT EXISTS legal_process_comment_mentions (
  comment_id BIGINT NOT NULL REFERENCES legal_process_comments(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
