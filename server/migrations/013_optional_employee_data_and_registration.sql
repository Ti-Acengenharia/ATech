ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(80);

ALTER TABLE collaborators
  ALTER COLUMN cpf_ciphertext DROP NOT NULL,
  ALTER COLUMN cpf_fingerprint DROP NOT NULL,
  ALTER COLUMN phone_ciphertext DROP NOT NULL;

DROP INDEX IF EXISTS collaborators_cpf_fingerprint_unique;
CREATE UNIQUE INDEX IF NOT EXISTS collaborators_cpf_fingerprint_unique
  ON collaborators (cpf_fingerprint)
  WHERE cpf_fingerprint IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS collaborators_registration_number_unique
  ON collaborators (lower(registration_number))
  WHERE registration_number IS NOT NULL;
