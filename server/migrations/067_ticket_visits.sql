CREATE TABLE IF NOT EXISTS ticket_visits (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(source_id) ON DELETE CASCADE,
  protocol VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',

  inspected_environments TEXT NOT NULL DEFAULT '',
  has_furniture VARCHAR(32) NOT NULL DEFAULT '',
  needs_clearance VARCHAR(32) NOT NULL DEFAULT '',
  damaged_furniture VARCHAR(32) NOT NULL DEFAULT '',
  needs_material_purchase VARCHAR(32) NOT NULL DEFAULT '',
  material_purchase_details TEXT NOT NULL DEFAULT '',
  estimated_execution_days INTEGER,
  standard_delivery_color VARCHAR(32) NOT NULL DEFAULT '',
  observations TEXT NOT NULL DEFAULT '',

  photos JSONB NOT NULL DEFAULT '{}'::jsonb,

  client_name VARCHAR(240),
  client_document VARCHAR(80),
  client_signature_data TEXT,
  visit_date TIMESTAMPTZ,

  declaration_attachment_id BIGINT REFERENCES ticket_attachments(id) ON DELETE SET NULL,
  report_attachment_id BIGINT REFERENCES ticket_attachments(id) ON DELETE SET NULL,

  cvcrm_declaration_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  cvcrm_declaration_error TEXT,
  cvcrm_declaration_sent_at TIMESTAMPTZ,
  cvcrm_report_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  cvcrm_report_error TEXT,
  cvcrm_report_sent_at TIMESTAMPTZ,

  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(200),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  finalized_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  finalized_by_name VARCHAR(200),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_visits_ticket_idx
  ON ticket_visits (ticket_id, created_at DESC);
