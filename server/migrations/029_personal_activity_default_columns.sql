WITH default_boards AS (
  SELECT c.user_id
  FROM personal_activity_columns c
  GROUP BY c.user_id
  HAVING count(*) = 3
     AND count(*) FILTER (WHERE c.position = 0 AND c.name = 'A fazer') = 1
     AND count(*) FILTER (WHERE c.position = 1 AND c.name = 'Em andamento') = 1
     AND count(*) FILTER (WHERE c.position = 2 AND c.name = 'Concluído') = 1
     AND NOT EXISTS (
       SELECT 1 FROM personal_activities a WHERE a.user_id = c.user_id
     )
)
UPDATE personal_activity_columns c
SET name = CASE c.position
  WHEN 0 THEN 'Novo'
  WHEN 2 THEN 'Pendente Validação'
  ELSE c.name
END
WHERE c.user_id IN (SELECT user_id FROM default_boards);

INSERT INTO personal_activity_columns (user_id, name, position)
SELECT c.user_id, 'Concluído', 3
FROM personal_activity_columns c
GROUP BY c.user_id
HAVING count(*) = 3
   AND count(*) FILTER (WHERE c.position = 0 AND c.name = 'Novo') = 1
   AND count(*) FILTER (WHERE c.position = 1 AND c.name = 'Em andamento') = 1
   AND count(*) FILTER (WHERE c.position = 2 AND c.name = 'Pendente Validação') = 1
   AND NOT EXISTS (
     SELECT 1 FROM personal_activities a WHERE a.user_id = c.user_id
   );
