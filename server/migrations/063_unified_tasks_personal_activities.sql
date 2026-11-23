-- 063_unified_tasks_personal_activities.sql
-- Unificação de tarefas criadas em Chamados (ticket_subtasks) e Processos Jurídicos (legal_process_items)
-- com o quadro de Minhas Atividades (personal_activities) de quem as criou.

ALTER TABLE personal_activities
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT REFERENCES tickets(source_id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS legal_process_id BIGINT REFERENCES legal_processes(id) ON DELETE CASCADE;

ALTER TABLE ticket_subtasks
  ADD COLUMN IF NOT EXISTS personal_activity_id BIGINT REFERENCES personal_activities(id) ON DELETE CASCADE;

ALTER TABLE legal_process_items
  ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS personal_activity_id BIGINT REFERENCES personal_activities(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS personal_activities_ticket_id_idx
  ON personal_activities (ticket_id) WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS personal_activities_legal_process_id_idx
  ON personal_activities (legal_process_id) WHERE legal_process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ticket_subtasks_personal_activity_id_idx
  ON ticket_subtasks (personal_activity_id) WHERE personal_activity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS legal_process_items_personal_activity_id_idx
  ON legal_process_items (personal_activity_id) WHERE personal_activity_id IS NOT NULL;

-- Backfill idempotente de tarefas existentes em Chamados e Processos Jurídicos para Minhas Atividades
DO $$
DECLARE
  rec RECORD;
  v_user_id BIGINT;
  v_initial_col_id BIGINT;
  v_done_col_id BIGINT;
  v_target_col_id BIGINT;
  v_new_activity_id BIGINT;
  v_tag TEXT;
BEGIN
  -- 1. Garantir colunas padrão de Minhas Atividades para todos os usuários ativos ou autores de tarefas
  FOR rec IN (
    SELECT DISTINCT u.id
    FROM users u
    WHERE u.status = 'active'
       OR EXISTS (SELECT 1 FROM ticket_subtasks st WHERE st.created_by = u.id)
       OR EXISTS (SELECT 1 FROM legal_processes lp WHERE lp.created_by = u.id)
       OR EXISTS (SELECT 1 FROM legal_process_assignees lpa WHERE lpa.user_id = u.id)
  ) LOOP
    INSERT INTO personal_activity_columns (user_id, name, position)
    SELECT rec.id, defaults.name, defaults.position
    FROM (VALUES
      ('Novo', 0),
      ('Em andamento', 1),
      ('Pendente Validação', 2),
      ('Concluído', 3)
    ) AS defaults(name, position)
    WHERE NOT EXISTS (
      SELECT 1 FROM personal_activity_columns WHERE user_id = rec.id
    );
  END LOOP;

  -- 2. Backfill de tarefas de chamados (ticket_subtasks) que ainda não possuem personal_activity_id
  FOR rec IN (
    SELECT st.id AS subtask_id,
           st.ticket_id,
           st.title,
           st.due_at,
           st.is_done,
           st.created_by,
           st.created_at,
           st.updated_at,
           t.protocol
    FROM ticket_subtasks st
    JOIN tickets t ON t.source_id = st.ticket_id
    WHERE st.personal_activity_id IS NULL
    ORDER BY st.id
  ) LOOP
    v_user_id := rec.created_by;
    IF v_user_id IS NULL THEN
      SELECT id INTO v_user_id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1;
    END IF;

    IF v_user_id IS NOT NULL THEN
      SELECT id INTO v_initial_col_id
      FROM personal_activity_columns
      WHERE user_id = v_user_id
      ORDER BY position, id
      LIMIT 1;

      SELECT id INTO v_done_col_id
      FROM personal_activity_columns
      WHERE user_id = v_user_id AND name ~* 'conclu'
      ORDER BY position DESC, id DESC
      LIMIT 1;

      IF v_done_col_id IS NULL THEN
        SELECT id INTO v_done_col_id
        FROM personal_activity_columns
        WHERE user_id = v_user_id
        ORDER BY position DESC, id DESC
        LIMIT 1;
      END IF;

      v_target_col_id := CASE WHEN rec.is_done THEN COALESCE(v_done_col_id, v_initial_col_id) ELSE v_initial_col_id END;
      v_tag := Left('Chamado #' || COALESCE(NULLIF(btrim(rec.protocol), ''), rec.ticket_id::text), 40);

      IF v_target_col_id IS NOT NULL THEN
        INSERT INTO personal_activity_tags (user_id, name)
        VALUES (v_user_id, v_tag)
        ON CONFLICT DO NOTHING;

        INSERT INTO personal_activities (
          user_id, column_id, title, description, priority, due_date, tags, ticket_id, created_at, updated_at
        )
        VALUES (
          v_user_id,
          v_target_col_id,
          Left(btrim(rec.title), 240),
          '',
          'medium',
          CASE WHEN rec.due_at IS NOT NULL THEN (rec.due_at AT TIME ZONE 'America/Maceio')::date ELSE NULL END,
          ARRAY[v_tag],
          rec.ticket_id,
          rec.created_at,
          rec.updated_at
        )
        RETURNING id INTO v_new_activity_id;

        UPDATE ticket_subtasks
        SET personal_activity_id = v_new_activity_id
        WHERE id = rec.subtask_id;
      END IF;
    END IF;
  END LOOP;
END $$;
