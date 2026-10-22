CREATE TABLE IF NOT EXISTS personal_activity_tags (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL CHECK (length(btrim(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_activity_tags_owner_name_unique
  ON personal_activity_tags (user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS personal_activity_tags_owner_name_index
  ON personal_activity_tags (user_id, lower(name), id);

INSERT INTO personal_activity_tags (user_id, name)
SELECT activity_tags.user_id, min(btrim(activity_tag.tag))
FROM personal_activities activity_tags
CROSS JOIN LATERAL unnest(activity_tags.tags) AS activity_tag(tag)
WHERE btrim(activity_tag.tag) <> ''
GROUP BY activity_tags.user_id, lower(btrim(activity_tag.tag))
ON CONFLICT DO NOTHING;
