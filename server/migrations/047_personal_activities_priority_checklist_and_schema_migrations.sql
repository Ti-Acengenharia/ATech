-- 047_personal_activities_priority_checklist_and_schema_migrations.sql
-- Tabela de controle de migrações e melhorias no kanban de atividades pessoais

CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suporte a prioridade nas atividades pessoais
ALTER TABLE personal_activities
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium';

-- Tabela de itens de checklist nas atividades pessoais
CREATE TABLE IF NOT EXISTS personal_activity_checklists (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES personal_activities(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL CHECK (length(btrim(title)) > 0),
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_activity_checklists_activity_position_idx
  ON personal_activity_checklists (activity_id, position, id);

-- Índice para acelerar busca textual por palavras na descrição e dados do chamado
CREATE INDEX IF NOT EXISTS tickets_search_fields_idx
  ON tickets (source_active, source_status_id, opened_at);

