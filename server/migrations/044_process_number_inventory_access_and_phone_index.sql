ALTER TABLE legal_processes
  ADD COLUMN IF NOT EXISTS process_number VARCHAR(100) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS legal_processes_process_number_index
  ON legal_processes (lower(btrim(process_number)))
  WHERE btrim(process_number) <> '';

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS customer_phone_tokens TEXT[];

CREATE INDEX IF NOT EXISTS tickets_customer_phone_tokens_gin
  ON tickets USING GIN (customer_phone_tokens);

INSERT INTO user_page_access (user_id, page_key, granted_by, granted_at)
SELECT user_id, 'inventory', granted_by, granted_at
FROM user_page_access
WHERE page_key = 'collaborators'
  AND NOT EXISTS (
    SELECT 1 FROM user_page_access WHERE page_key = 'inventory'
  )
ON CONFLICT (user_id, page_key) DO NOTHING;

