-- Migration 054: Adiciona work_status na tabela enterprise_information e sincroniza obras finalizadas com stock_units

ALTER TABLE enterprise_information
  ADD COLUMN IF NOT EXISTS work_status VARCHAR(40) NOT NULL DEFAULT 'in_progress';

-- Atualiza ou insere obras finalizadas conhecidas (Aruana Prime, Aruana Park, etc.)
INSERT INTO enterprise_information (enterprise_key, enterprise_name, work_status)
VALUES
  ('aruana prime residence', 'Aruana Prime Residence', 'finished'),
  ('aruana park residence', 'Aruana Park Residence', 'finished'),
  ('aruana praia residence', 'Aruana Praia Residence', 'finished'),
  ('pérolas do luzia', 'Pérolas do Luzia', 'finished'),
  ('pérolas da atalaia', 'Pérolas da Atalaia', 'finished'),
  ('reserva josefina carvalho', 'Reserva Josefina Carvalho', 'finished'),
  ('reserva cenezeu rabelo', 'Reserva Cenezeu Rabelo', 'finished'),
  ('alto santa lúcia', 'Alto Santa Lúcia', 'finished'),
  ('parque nascente', 'Parque Nascente', 'finished')
ON CONFLICT (enterprise_key) DO UPDATE SET
  work_status = 'finished';

-- Sincroniza imediatamente stock_units para que Aruana Prime, Aruana Park e demais obras finalizadas reflitam is_delivered = true
UPDATE stock_units
SET is_delivered = true,
    enterprise_status = 'Obras Finalizadas'
WHERE lower(enterprise_name) LIKE '%aruana prime%'
   OR lower(enterprise_name) LIKE '%aruana park%'
   OR lower(enterprise_name) LIKE '%aruana praia%'
   OR lower(enterprise_name) LIKE '%luzia%'
   OR lower(enterprise_name) LIKE '%atalaia%'
   OR lower(enterprise_name) LIKE '%josefina%'
   OR lower(enterprise_name) LIKE '%cenezeu%'
   OR lower(enterprise_name) LIKE '%alto santa%'
   OR lower(enterprise_name) LIKE '%nascente%';

