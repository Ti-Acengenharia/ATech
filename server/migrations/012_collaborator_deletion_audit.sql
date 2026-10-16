ALTER TABLE collaborator_sensitive_data_access
  ADD COLUMN IF NOT EXISTS collaborator_name_snapshot VARCHAR(160) NOT NULL DEFAULT '';

UPDATE collaborator_sensitive_data_access access_log
SET collaborator_name_snapshot = collaborators.name
FROM collaborators
WHERE access_log.collaborator_id = collaborators.id
  AND access_log.collaborator_name_snapshot = '';

DO $$
DECLARE
  existing_fk TEXT;
BEGIN
  SELECT conname INTO existing_fk
  FROM pg_constraint
  WHERE conrelid = 'collaborator_sensitive_data_access'::regclass
    AND confrelid = 'collaborators'::regclass
    AND contype = 'f';

  IF existing_fk IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE collaborator_sensitive_data_access DROP CONSTRAINT %I',
      existing_fk
    );
  END IF;
END $$;

ALTER TABLE collaborator_sensitive_data_access
  ALTER COLUMN collaborator_id DROP NOT NULL,
  ADD CONSTRAINT collaborator_sensitive_data_access_collaborator_id_fkey
    FOREIGN KEY (collaborator_id) REFERENCES collaborators(id) ON DELETE SET NULL;
