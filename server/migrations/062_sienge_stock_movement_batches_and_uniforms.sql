ALTER TABLE sienge_stock_movements
  DROP CONSTRAINT IF EXISTS sienge_stock_movements_operation_type_check,
  DROP CONSTRAINT IF EXISTS sienge_stock_movements_check,
  DROP CONSTRAINT IF EXISTS sienge_stock_movements_check1;

ALTER TABLE sienge_stock_movements
  ADD COLUMN uniform_details JSONB,
  ADD CONSTRAINT sienge_stock_movements_operation_type_check
    CHECK (operation_type IN ('issue', 'transfer', 'epi_delivery', 'uniform_delivery')),
  ADD CONSTRAINT sienge_stock_movements_transfer_check
    CHECK (
      (operation_type = 'transfer'
        AND destination_cost_center_id IS NOT NULL
        AND destination_cost_center_id <> cost_center_id
        AND destination_resource_id IS NOT NULL
        AND destination_resource_id > 0)
      OR
      (operation_type <> 'transfer'
        AND destination_cost_center_id IS NULL
        AND destination_resource_id IS NULL)
    ),
  ADD CONSTRAINT sienge_stock_movements_signed_delivery_check
    CHECK (
      (operation_type IN ('epi_delivery', 'uniform_delivery')
        AND collaborator_id IS NOT NULL
        AND deliverer_signature_ciphertext IS NOT NULL
        AND recipient_signature_ciphertext IS NOT NULL)
      OR
      (operation_type NOT IN ('epi_delivery', 'uniform_delivery')
        AND collaborator_id IS NULL
        AND deliverer_signature_ciphertext IS NULL
        AND recipient_signature_ciphertext IS NULL)
    ),
  ADD CONSTRAINT sienge_stock_movements_uniform_details_check
    CHECK (
      (operation_type = 'uniform_delivery' AND uniform_details IS NOT NULL)
      OR (operation_type <> 'uniform_delivery' AND uniform_details IS NULL)
    );

CREATE TABLE IF NOT EXISTS sienge_stock_movement_items (
  id BIGSERIAL PRIMARY KEY,
  movement_id BIGINT NOT NULL
    REFERENCES sienge_stock_movements(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  snapshot_item_id BIGINT NOT NULL,
  sienge_item_id INTEGER,
  resource_id INTEGER NOT NULL CHECK (resource_id > 0),
  resource_description TEXT NOT NULL,
  detail_id INTEGER,
  detail_description TEXT,
  trademark_id INTEGER,
  trademark_description TEXT,
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  unit_of_measure VARCHAR(32) NOT NULL,
  destination_resource_id INTEGER,
  destination_detail_id INTEGER,
  destination_trademark_id INTEGER,
  source_building_appropriations JSONB NOT NULL,
  destination_building_appropriations JSONB,
  UNIQUE (movement_id, line_number)
);

CREATE INDEX IF NOT EXISTS sienge_stock_movement_items_snapshot_index
  ON sienge_stock_movement_items (snapshot_item_id);
