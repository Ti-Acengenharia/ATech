CREATE TABLE IF NOT EXISTS collaborator_roles (
  role_key VARCHAR(80) PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT collaborator_roles_key_format
    CHECK (role_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

INSERT INTO collaborator_roles (role_key, label) VALUES
  ('pedreiro', 'Pedreiro'),
  ('ajudante', 'Ajudante'),
  ('pintor', 'Pintor'),
  ('eletricista', 'Eletricista'),
  ('encanador', 'Encanador'),
  ('fornecedor_terceirizado', 'Fornecedor terceirizado'),
  ('analista', 'Analista'),
  ('assistente', 'Assistente'),
  ('gestor', 'Gestor'),
  ('gerente', 'Gerente'),
  ('encarregado', 'Encarregado')
ON CONFLICT (role_key) DO NOTHING;

ALTER TABLE collaborators
  DROP CONSTRAINT IF EXISTS collaborators_role_check;
