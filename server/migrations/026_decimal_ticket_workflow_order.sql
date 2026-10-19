ALTER TABLE ticket_workflow_stages
  ALTER COLUMN position TYPE NUMERIC USING position::numeric;
