CREATE TABLE IF NOT EXISTS inventory_sienge_cost_centers (
  cost_center_id INTEGER PRIMARY KEY CHECK (cost_center_id > 0),
  location_id BIGINT REFERENCES inventory_locations(id) ON DELETE SET NULL,
  department_id INTEGER CHECK (department_id IS NULL OR department_id > 0),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO inventory_sienge_cost_centers (cost_center_id)
SELECT DISTINCT center_id.value::integer
FROM application_settings setting
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(setting.setting_value->'costCenterIds') = 'array'
      THEN setting.setting_value->'costCenterIds'
    ELSE '[]'::jsonb
  END
) AS center_id(value)
WHERE setting.setting_key = 'sienge_stock_settings'
  AND center_id.value ~ '^[1-9][0-9]{0,9}$'
  AND center_id.value::numeric <= 2147483647
ON CONFLICT (cost_center_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS inventory_sienge_cost_centers_location_index
  ON inventory_sienge_cost_centers (location_id, cost_center_id);

CREATE TABLE IF NOT EXISTS sienge_stock_snapshots (
  cost_center_id INTEGER PRIMARY KEY
    REFERENCES inventory_sienge_cost_centers(cost_center_id) ON DELETE RESTRICT,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  synchronized_at TIMESTAMPTZ NOT NULL,
  synchronized_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  needs_refresh BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS sienge_stock_items (
  cost_center_id INTEGER NOT NULL
    REFERENCES inventory_sienge_cost_centers(cost_center_id) ON DELETE RESTRICT,
  sienge_item_id INTEGER NOT NULL CHECK (sienge_item_id > 0),
  resource_id INTEGER NOT NULL CHECK (resource_id > 0),
  resource_description TEXT NOT NULL,
  detail_id INTEGER,
  detail_description TEXT,
  trademark_id INTEGER,
  trademark_description TEXT,
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity >= 0),
  unit_of_measure VARCHAR(32) NOT NULL,
  average_price NUMERIC(20, 6),
  synchronized_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (cost_center_id, sienge_item_id)
);

CREATE INDEX IF NOT EXISTS sienge_stock_items_resource_index
  ON sienge_stock_items (resource_id, cost_center_id);

CREATE TABLE IF NOT EXISTS sienge_stock_movements (
  id BIGSERIAL PRIMARY KEY,
  request_key UUID NOT NULL UNIQUE,
  operation_type VARCHAR(16) NOT NULL
    CHECK (operation_type IN ('issue', 'transfer', 'epi_delivery')),
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('pending', 'succeeded', 'failed', 'unknown')),
  cost_center_id INTEGER NOT NULL
    REFERENCES inventory_sienge_cost_centers(cost_center_id) ON DELETE RESTRICT,
  destination_cost_center_id INTEGER
    REFERENCES inventory_sienge_cost_centers(cost_center_id) ON DELETE RESTRICT,
  sienge_item_id INTEGER NOT NULL CHECK (sienge_item_id > 0),
  destination_resource_id INTEGER,
  resource_id INTEGER NOT NULL CHECK (resource_id > 0),
  detail_id INTEGER,
  trademark_id INTEGER,
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  unit_of_measure VARCHAR(32) NOT NULL,
  transaction_date DATE NOT NULL,
  collaborator_id BIGINT REFERENCES collaborators(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(160) NOT NULL,
  request_payload JSONB NOT NULL,
  response_status INTEGER,
  response_payload JSONB,
  error_message TEXT,
  reconciliation_note TEXT,
  reconciled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMPTZ,
  deliverer_signature_ciphertext TEXT,
  recipient_signature_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (operation_type = 'transfer'
      AND destination_cost_center_id IS NOT NULL
      AND destination_cost_center_id <> cost_center_id
      AND destination_resource_id IS NOT NULL
      AND destination_resource_id > 0)
    OR
    (operation_type <> 'transfer' AND destination_cost_center_id IS NULL
      AND destination_resource_id IS NULL)
  ),
  CHECK (
    (operation_type = 'epi_delivery'
      AND collaborator_id IS NOT NULL
      AND deliverer_signature_ciphertext IS NOT NULL
      AND recipient_signature_ciphertext IS NOT NULL)
    OR
    (operation_type <> 'epi_delivery'
      AND collaborator_id IS NULL
      AND deliverer_signature_ciphertext IS NULL
      AND recipient_signature_ciphertext IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS sienge_stock_movements_history_index
  ON sienge_stock_movements (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS sienge_stock_movements_collaborator_index
  ON sienge_stock_movements (collaborator_id, transaction_date DESC, id DESC)
  WHERE collaborator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sienge_stock_movements_unresolved_index
  ON sienge_stock_movements (created_at, id)
  WHERE status IN ('pending', 'unknown');
