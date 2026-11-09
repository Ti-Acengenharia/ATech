-- Migration 053: Adiciona suporte a obras entregues e notificacoes de alteracao de status de estoque

-- Campos de entrega e situacao da obra na tabela stock_units
ALTER TABLE stock_units
  ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enterprise_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS enterprise_delivery_date VARCHAR(50);

CREATE INDEX IF NOT EXISTS stock_units_delivered_idx ON stock_units (is_delivered);

-- Tabela de notificacoes de alteracao de situacao de estoque
CREATE TABLE IF NOT EXISTS stock_unit_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_unit_id BIGINT NOT NULL REFERENCES stock_units(id) ON DELETE CASCADE,
  enterprise_id INT NOT NULL,
  enterprise_name VARCHAR(255) NOT NULL,
  unit_name VARCHAR(100) NOT NULL,
  block_name VARCHAR(100),
  old_status VARCHAR(100),
  new_status VARCHAR(100) NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stock_unit_notifications_user_idx
  ON stock_unit_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_unit_notifications_unread_idx
  ON stock_unit_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

