DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_sessions'
      AND column_name = 'session_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_sessions'
      AND column_name = 'sid'
  ) THEN
    ALTER TABLE user_sessions RENAME COLUMN session_id TO sid;
  END IF;
END
$$;