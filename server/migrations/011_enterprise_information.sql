CREATE TABLE IF NOT EXISTS enterprise_information (
  enterprise_key TEXT PRIMARY KEY,
  enterprise_name VARCHAR(240) NOT NULL,
  syndic_name VARCHAR(160) NOT NULL DEFAULT '',
  syndic_phone VARCHAR(40) NOT NULL DEFAULT '',
  syndic_email VARCHAR(254) NOT NULL DEFAULT '',
  supervisor_name VARCHAR(160) NOT NULL DEFAULT '',
  supervisor_phone VARCHAR(40) NOT NULL DEFAULT '',
  supervisor_email VARCHAR(254) NOT NULL DEFAULT '',
  condominium_email VARCHAR(254) NOT NULL DEFAULT '',
  occupancy_permit_date DATE,
  condominium_delivery_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
