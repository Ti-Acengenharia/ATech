ALTER TABLE sienge_stock_items
  ADD COLUMN snapshot_item_id BIGSERIAL;

ALTER TABLE sienge_stock_items
  DROP CONSTRAINT sienge_stock_items_pkey;

ALTER TABLE sienge_stock_items
  ADD CONSTRAINT sienge_stock_items_pkey PRIMARY KEY (snapshot_item_id);

ALTER TABLE sienge_stock_items
  ALTER COLUMN sienge_item_id DROP NOT NULL;

ALTER TABLE sienge_stock_movements
  ALTER COLUMN sienge_item_id DROP NOT NULL;
