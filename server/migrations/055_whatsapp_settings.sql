-- Migration 055: Limpeza de configurações de WhatsApp do banco de dados
-- Todas as credenciais da Evolution API são gerenciadas exclusivamente via variáveis de ambiente (.env)
DELETE FROM application_settings WHERE setting_key = 'whatsapp_settings';
