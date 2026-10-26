CREATE TABLE IF NOT EXISTS inventory_item_types (
  id BIGSERIAL PRIMARY KEY,
  label VARCHAR(60) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_types_label_unique
  ON inventory_item_types (lower(btrim(label)));

INSERT INTO inventory_item_types (label, is_system)
VALUES ('Material', TRUE), ('Equipamento', TRUE), ('EPI', TRUE), ('EPC', TRUE), ('Ferramenta', TRUE)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  type_id BIGINT NOT NULL REFERENCES inventory_item_types(id),
  base_unit VARCHAR(32) NOT NULL,
  minimum_stock NUMERIC(16, 4) NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_type_unique
  ON inventory_items (type_id, lower(btrim(name))) WHERE is_active;

CREATE TABLE IF NOT EXISTS inventory_item_conversions (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  unit_name VARCHAR(32) NOT NULL,
  factor_to_base NUMERIC(16, 6) NOT NULL CHECK (factor_to_base > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_conversions_name_unique
  ON inventory_item_conversions (item_id, lower(btrim(unit_name)));

CREATE TABLE IF NOT EXISTS inventory_documents (
  id BIGSERIAL PRIMARY KEY,
  document_type VARCHAR(24) NOT NULL
    CHECK (document_type IN ('entry', 'exit', 'epi_delivery', 'tool_delivery', 'tool_return')),
  collaborator_id BIGINT REFERENCES collaborators(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users(id),
  deliverer_signature_ciphertext TEXT,
  recipient_signature_ciphertext TEXT,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (document_type IN ('epi_delivery', 'tool_delivery', 'tool_return')
      AND collaborator_id IS NOT NULL
      AND deliverer_signature_ciphertext IS NOT NULL
      AND recipient_signature_ciphertext IS NOT NULL)
    OR
    (document_type IN ('entry', 'exit')
      AND collaborator_id IS NULL
      AND deliverer_signature_ciphertext IS NULL
      AND recipient_signature_ciphertext IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS inventory_documents_history_index
  ON inventory_documents (collaborator_id, transaction_date DESC, id DESC)
  WHERE collaborator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_document_items (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES inventory_documents(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(16, 4) NOT NULL CHECK (quantity > 0),
  unit_name VARCHAR(32) NOT NULL,
  factor_to_base NUMERIC(16, 6) NOT NULL CHECK (factor_to_base > 0),
  base_quantity NUMERIC(20, 6) NOT NULL CHECK (base_quantity > 0),
  source_delivery_item_id BIGINT REFERENCES inventory_document_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_document_items_item_index
  ON inventory_document_items (item_id, document_id);

CREATE INDEX IF NOT EXISTS inventory_document_items_source_index
  ON inventory_document_items (source_delivery_item_id)
  WHERE source_delivery_item_id IS NOT NULL;
