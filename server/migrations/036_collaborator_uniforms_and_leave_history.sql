CREATE TABLE IF NOT EXISTS collaborator_shirt_sizes (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(24) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS collaborator_shirt_sizes_name_unique
  ON collaborator_shirt_sizes (lower(btrim(name)));

INSERT INTO collaborator_shirt_sizes (name)
VALUES ('P'), ('M'), ('G'), ('GG'), ('XG'), ('XXG')
ON CONFLICT DO NOTHING;

ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS shirt_size_id BIGINT REFERENCES collaborator_shirt_sizes(id),
  ADD COLUMN IF NOT EXISTS shirt_short_sleeve_qty SMALLINT NOT NULL DEFAULT 0
    CHECK (shirt_short_sleeve_qty BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS shirt_long_sleeve_qty SMALLINT NOT NULL DEFAULT 0
    CHECK (shirt_long_sleeve_qty BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS pants_size SMALLINT
    CHECK (pants_size IS NULL OR (pants_size BETWEEN 32 AND 58 AND pants_size % 2 = 0)),
  ADD COLUMN IF NOT EXISTS boot_size SMALLINT
    CHECK (boot_size IS NULL OR boot_size BETWEEN 34 AND 48);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collaborators_shirt_quantity_limit'
      AND conrelid = 'collaborators'::regclass
  ) THEN
    ALTER TABLE collaborators
      ADD CONSTRAINT collaborators_shirt_quantity_limit
      CHECK (shirt_short_sleeve_qty + shirt_long_sleeve_qty <= 3);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS collaborator_leave_history (
  id BIGSERIAL PRIMARY KEY,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  start_date_ciphertext TEXT NOT NULL,
  expected_return_date_ciphertext TEXT NOT NULL,
  reason_ciphertext TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  ended_at DATE,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((is_current AND ended_at IS NULL) OR (NOT is_current))
);

CREATE UNIQUE INDEX IF NOT EXISTS collaborator_leave_one_current_unique
  ON collaborator_leave_history (collaborator_id) WHERE is_current;

INSERT INTO collaborator_leave_history (
  collaborator_id, start_date_ciphertext, expected_return_date_ciphertext,
  reason_ciphertext, is_current, created_by, created_at
)
SELECT id, leave_start_date_ciphertext, expected_return_date_ciphertext,
       leave_reason_ciphertext, TRUE, updated_by, updated_at
FROM collaborators
WHERE is_on_leave
  AND leave_start_date_ciphertext IS NOT NULL
  AND expected_return_date_ciphertext IS NOT NULL
  AND leave_reason_ciphertext IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS collaborator_uniform_deliveries (
  id BIGSERIAL PRIMARY KEY,
  collaborator_id BIGINT NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  delivery_date DATE NOT NULL,
  shirt_size_id BIGINT REFERENCES collaborator_shirt_sizes(id),
  shirt_short_sleeve_qty SMALLINT NOT NULL DEFAULT 0 CHECK (shirt_short_sleeve_qty BETWEEN 0 AND 99),
  shirt_long_sleeve_qty SMALLINT NOT NULL DEFAULT 0 CHECK (shirt_long_sleeve_qty BETWEEN 0 AND 99),
  pants_size SMALLINT CHECK (pants_size IS NULL OR (pants_size BETWEEN 32 AND 58 AND pants_size % 2 = 0)),
  pants_qty SMALLINT NOT NULL DEFAULT 0 CHECK (pants_qty BETWEEN 0 AND 99),
  boot_size SMALLINT CHECK (boot_size IS NULL OR boot_size BETWEEN 34 AND 48),
  boot_qty SMALLINT NOT NULL DEFAULT 0 CHECK (boot_qty BETWEEN 0 AND 99),
  deliverer_user_id BIGINT NOT NULL REFERENCES users(id),
  deliverer_signature_ciphertext TEXT NOT NULL,
  recipient_signature_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (shirt_short_sleeve_qty + shirt_long_sleeve_qty > 0 AND shirt_size_id IS NOT NULL)
    OR (shirt_short_sleeve_qty + shirt_long_sleeve_qty = 0)
  ),
  CHECK ((pants_qty > 0 AND pants_size IS NOT NULL) OR (pants_qty = 0)),
  CHECK ((boot_qty > 0 AND boot_size IS NOT NULL) OR (boot_qty = 0)),
  CHECK (shirt_short_sleeve_qty + shirt_long_sleeve_qty + pants_qty + boot_qty > 0)
);

CREATE INDEX IF NOT EXISTS collaborator_uniform_deliveries_history_index
  ON collaborator_uniform_deliveries (collaborator_id, delivery_date DESC, id DESC);
