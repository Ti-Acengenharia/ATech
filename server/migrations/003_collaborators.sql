CREATE TABLE IF NOT EXISTS collaborators (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  nickname VARCHAR(80) NOT NULL DEFAULT '',
  role VARCHAR(40) NOT NULL CHECK (role IN (
    'pedreiro', 'ajudante', 'pintor', 'eletricista', 'encanador',
    'fornecedor_terceirizado', 'analista', 'assistente', 'gestor',
    'gerente', 'encarregado'
  )),
  cpf_ciphertext TEXT NOT NULL,
  cpf_fingerprint CHAR(64) NOT NULL,
  phone_ciphertext TEXT NOT NULL,
  gender VARCHAR(24) NOT NULL CHECK (gender IN ('feminino', 'masculino', 'outro', 'nao_informar')),
  birth_date_ciphertext TEXT NOT NULL,
  admission_date DATE NOT NULL,
  termination_date DATE,
  has_children BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  updated_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT collaborator_termination_after_admission
    CHECK (termination_date IS NULL OR termination_date >= admission_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS collaborators_cpf_fingerprint_unique
  ON collaborators (cpf_fingerprint);
CREATE INDEX IF NOT EXISTS collaborators_name_prefix_index
  ON collaborators (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS collaborators_nickname_prefix_index
  ON collaborators (lower(nickname) text_pattern_ops);
CREATE INDEX IF NOT EXISTS collaborators_role_status_index
  ON collaborators (role, termination_date);

CREATE TABLE IF NOT EXISTS collaborator_children (
  id BIGSERIAL PRIMARY KEY,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name_ciphertext TEXT NOT NULL,
  birth_date_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collaborator_children_collaborator_index
  ON collaborator_children (collaborator_id);

CREATE TABLE IF NOT EXISTS collaborator_sensitive_data_access (
  id BIGSERIAL PRIMARY KEY,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  accessed_by BIGINT NOT NULL REFERENCES users(id),
  purpose VARCHAR(80) NOT NULL DEFAULT 'collaborator-report',
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collaborator_sensitive_access_audit_index
  ON collaborator_sensitive_data_access (collaborator_id, accessed_at DESC);