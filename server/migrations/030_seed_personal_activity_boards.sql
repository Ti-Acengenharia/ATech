INSERT INTO personal_activity_columns (user_id, name, position)
SELECT users_with_access.id, defaults.name, defaults.position
FROM users users_with_access
CROSS JOIN (VALUES
  ('Novo', 0),
  ('Em andamento', 1),
  ('Pendente Validação', 2),
  ('Concluído', 3)
) AS defaults(name, position)
WHERE users_with_access.status = 'active'
  AND (
    users_with_access.role = 'admin'
    OR EXISTS (
      SELECT 1
      FROM user_page_access
      WHERE user_id = users_with_access.id
        AND page_key = 'personal-activities'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM personal_activity_columns
    WHERE user_id = users_with_access.id
  );
