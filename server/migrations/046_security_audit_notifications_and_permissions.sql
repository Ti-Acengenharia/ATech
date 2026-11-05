-- Bloqueio progressivo de tentativas de login administrativo
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ;

-- Controle de leitura e data de menções em comentários de processos jurídicos
ALTER TABLE legal_process_comment_mentions
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS legal_process_comment_mentions_user_unread_idx
  ON legal_process_comment_mentions (user_id, read_at, comment_id DESC);

-- Trilha centralizada de auditoria de ações administrativas e exclusões críticas
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(160) NOT NULL DEFAULT '',
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(60) NOT NULL,
  resource_id VARCHAR(120) NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_audit_logs_created_idx
  ON system_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS system_audit_logs_resource_idx
  ON system_audit_logs (resource_type, resource_id);

-- Concessão inicial única de 'letter-filling' para usuários que já possuem acesso a 'tickets'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM application_settings WHERE setting_key = 'migration_046_letter_filling_backfilled'
  ) THEN
    INSERT INTO user_page_access (user_id, page_key, granted_by)
    SELECT user_id, 'letter-filling', granted_by
    FROM user_page_access
    WHERE page_key = 'tickets'
    ON CONFLICT (user_id, page_key) DO NOTHING;

    INSERT INTO application_settings (setting_key, setting_value, updated_at)
    VALUES ('migration_046_letter_filling_backfilled', 'true'::jsonb, now())
    ON CONFLICT (setting_key) DO NOTHING;
  END IF;
END $$;

