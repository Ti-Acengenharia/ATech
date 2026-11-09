-- Tabela de Unidades em Estoque (espelho sincronizado do CV CRM)
CREATE TABLE IF NOT EXISTS stock_units (
  id SERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL,
  enterprise_name VARCHAR(240) NOT NULL,
  unit_id INT NOT NULL,
  unit_name VARCHAR(120) NOT NULL,
  block_id INT,
  block_name VARCHAR(120),
  stage_name VARCHAR(120),
  floor VARCHAR(50),
  typology VARCHAR(240),
  position VARCHAR(120),
  private_area NUMERIC(10,2),
  total_area NUMERIC(10,2),
  status_id INT,
  status_name VARCHAR(120) DEFAULT 'Disponível',
  status_reason VARCHAR(255),
  valuation_value NUMERIC(14,2),
  next_inspection_date DATE,
  last_inspection_date DATE,
  last_inspection_status VARCHAR(50),
  last_inspection_technician VARCHAR(200),
  raw_data JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT stock_units_enterprise_unit_unique UNIQUE(enterprise_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_units_enterprise ON stock_units(enterprise_name);
CREATE INDEX IF NOT EXISTS idx_stock_units_next_inspection ON stock_units(next_inspection_date);
CREATE INDEX IF NOT EXISTS idx_stock_units_status ON stock_units(status_name);

-- Tabela de Vistorias Técnicas Realizadas
CREATE TABLE IF NOT EXISTS unit_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_unit_id INT NOT NULL REFERENCES stock_units(id) ON DELETE CASCADE,
  enterprise_id INT NOT NULL,
  enterprise_name VARCHAR(240) NOT NULL,
  unit_id INT NOT NULL,
  unit_name VARCHAR(120) NOT NULL,
  block_name VARCHAR(120),
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  technician_id INT REFERENCES users(id) ON DELETE SET NULL,
  technician_name VARCHAR(200) NOT NULL,
  collaborator_id INT REFERENCES collaborators(id) ON DELETE SET NULL,
  collaborator_name VARCHAR(200),
  overall_status VARCHAR(30) NOT NULL DEFAULT 'approved',
  approved_count INT NOT NULL DEFAULT 0,
  reproved_count INT NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  general_notes TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_inspections_unit ON unit_inspections(stock_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_inspections_date ON unit_inspections(inspection_date);

-- Tabela de Fotos das Vistorias
CREATE TABLE IF NOT EXISTS unit_inspection_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES unit_inspections(id) ON DELETE CASCADE,
  item_key VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(150) NOT NULL,
  file_size INT NOT NULL,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_inspection_photos_insp ON unit_inspection_photos(inspection_id);

