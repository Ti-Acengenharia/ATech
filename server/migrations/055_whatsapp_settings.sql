-- Migration 055: WhatsApp settings and automated dispatch state
INSERT INTO application_settings (setting_key, setting_value)
VALUES ('whatsapp_settings', '{
  "apiUrl": "",
  "apiKey": "",
  "instanceName": "",
  "programmingGroupJid": "",
  "foremanPhoneNumber": "",
  "autoDispatchEnabled": true
}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

