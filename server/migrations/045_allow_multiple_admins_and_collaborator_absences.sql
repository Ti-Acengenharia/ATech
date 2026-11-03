-- Permite múltiplos administradores e administradores sem senha local (ex.: autenticados via Google Workspace)
DROP INDEX IF EXISTS only_one_atech_admin;
ALTER TABLE users DROP CONSTRAINT IF EXISTS admin_requires_password;
ALTER TABLE users DROP CONSTRAINT IF EXISTS member_has_no_password;

-- Tabela de registro de atestados médicos e faltas injustificadas
CREATE TABLE IF NOT EXISTS collaborator_absences (
  id BIGSERIAL PRIMARY KEY,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('atestado', 'falta_injustificada')),
  start_date DATE NOT NULL,
  days_count INTEGER NOT NULL CHECK (days_count >= 1),
  end_date DATE NOT NULL,
  cid VARCHAR(20),
  notes TEXT,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT collaborator_absences_valid_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS collaborator_absences_collaborator_idx
  ON collaborator_absences (collaborator_id, start_date DESC);

CREATE INDEX IF NOT EXISTS collaborator_absences_date_range_idx
  ON collaborator_absences (start_date, end_date);

