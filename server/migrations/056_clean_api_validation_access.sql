-- Migration 056: Remove permissões residuais da página api-validation para usuários não-administradores
-- A tela de validação da API e as ações de sincronização com o CVCRM são restritas exclusivamente a administradores
DELETE FROM user_page_access WHERE page_key = 'api-validation';

