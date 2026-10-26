CREATE TABLE IF NOT EXISTS inventory_locations (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_name_unique
  ON inventory_locations (lower(btrim(name)));

INSERT INTO inventory_locations (name, created_by)
SELECT initial.name, (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)
FROM (VALUES ('Galpão Santa Lúcia'), ('Ponto de Apoio GrandView')) AS initial(name)
ON CONFLICT DO NOTHING;

ALTER TABLE inventory_documents
  DROP CONSTRAINT IF EXISTS inventory_documents_document_type_check;

ALTER TABLE inventory_documents
  ADD CONSTRAINT inventory_documents_document_type_check
  CHECK (document_type IN ('entry', 'exit', 'epi_delivery', 'tool_delivery', 'tool_return', 'transfer'));

ALTER TABLE inventory_documents
  DROP CONSTRAINT IF EXISTS inventory_documents_check;

ALTER TABLE inventory_documents
  DROP CONSTRAINT IF EXISTS inventory_documents_signature_check;

ALTER TABLE inventory_documents
  ADD CONSTRAINT inventory_documents_signature_check
  CHECK (
    (
      document_type IN ('epi_delivery', 'tool_delivery', 'tool_return')
      AND collaborator_id IS NOT NULL
      AND deliverer_signature_ciphertext IS NOT NULL
      AND recipient_signature_ciphertext IS NOT NULL
    )
    OR
    (
      document_type IN ('entry', 'exit', 'transfer')
      AND collaborator_id IS NULL
      AND deliverer_signature_ciphertext IS NULL
      AND recipient_signature_ciphertext IS NULL
    )
  );

ALTER TABLE inventory_documents
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS destination_location_id BIGINT REFERENCES inventory_locations(id) ON DELETE RESTRICT;

UPDATE inventory_documents
SET location_id = (SELECT id FROM inventory_locations WHERE name = 'Galpão Santa Lúcia')
WHERE location_id IS NULL
  AND document_type <> 'transfer'
  AND EXISTS (SELECT 1 FROM inventory_locations WHERE name = 'Galpão Santa Lúcia');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_documents_location_check'
      AND conrelid = 'inventory_documents'::regclass
  ) THEN
    ALTER TABLE inventory_documents
      ADD CONSTRAINT inventory_documents_location_check
      CHECK (
        (
          document_type <> 'transfer'
          AND location_id IS NOT NULL
          AND source_location_id IS NULL
          AND destination_location_id IS NULL
        )
        OR
        (
          document_type = 'transfer'
          AND location_id IS NULL
          AND source_location_id IS NOT NULL
          AND destination_location_id IS NOT NULL
          AND source_location_id <> destination_location_id
          AND collaborator_id IS NULL
          AND deliverer_signature_ciphertext IS NULL
          AND recipient_signature_ciphertext IS NULL
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS inventory_documents_location_history_index
  ON inventory_documents (location_id, transaction_date DESC, id DESC)
  WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_documents_transfer_history_index
  ON inventory_documents (source_location_id, destination_location_id, transaction_date DESC)
  WHERE document_type = 'transfer';
