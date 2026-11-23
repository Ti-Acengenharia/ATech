CREATE TABLE IF NOT EXISTS enterprise_documents (
  id BIGSERIAL PRIMARY KEY,
  enterprise_key VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Geral',
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(150) NOT NULL DEFAULT 'application/pdf',
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 31457280),
  content BYTEA NOT NULL,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enterprise_documents_key_idx
  ON enterprise_documents (enterprise_key, created_at DESC);
