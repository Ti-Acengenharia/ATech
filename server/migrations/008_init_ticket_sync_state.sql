INSERT INTO ticket_sync_state (id, baseline_completed, auto_sync_enabled)
VALUES (1, FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;
