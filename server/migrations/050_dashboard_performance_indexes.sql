-- 050_dashboard_performance_indexes.sql
-- Índices para otimização de alta performance no Dashboard de Chamados e filtros

-- 1. Índice por data de abertura (filtro principal de período)
CREATE INDEX IF NOT EXISTS tickets_opened_at_idx ON tickets (opened_at);

-- 2. Índice composto para chamados ativos por período
CREATE INDEX IF NOT EXISTS tickets_active_opened_idx ON tickets (source_active, opened_at);

-- 3. Índice essencial no histórico de atividades para finalizações/cancelamentos por data
CREATE INDEX IF NOT EXISTS ticket_activity_history_event_created_idx 
ON ticket_activity_history (event_type, created_at);

-- 4. Índices funcionais para filtros textuais e agrupamentos (GROUP BY lower(btrim(...)))
CREATE INDEX IF NOT EXISTS tickets_enterprise_lower_idx ON tickets ((lower(btrim(enterprise))));
CREATE INDEX IF NOT EXISTS tickets_block_lower_idx ON tickets ((lower(btrim(block))));
CREATE INDEX IF NOT EXISTS tickets_unit_lower_idx ON tickets ((lower(btrim(unit))));
CREATE INDEX IF NOT EXISTS tickets_subsubject_lower_idx ON tickets ((lower(btrim(subsubject))));

-- 5. Índice por assunto e status para filtros e contagens de situação
CREATE INDEX IF NOT EXISTS tickets_source_subject_id_idx ON tickets (source_subject_id);
CREATE INDEX IF NOT EXISTS tickets_source_status_name_idx ON tickets (source_status_name);

-- 6. Índice parcial para chamados inativos com data de modificação (snapshot closures)
CREATE INDEX IF NOT EXISTS tickets_source_modified_active_idx 
ON tickets (source_active, source_modified_at) 
WHERE NOT source_active;

