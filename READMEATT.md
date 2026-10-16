# Revisão de segurança e limpeza

## Registro da revisão

| # | Severidade | Arquivo | Achado | Correção |
|---|---|---|---|---|
| 1 | Alta | `server/auth.ts` | Uma sessão existente continuava autorizada depois que a conta era suspensa, até o cookie expirar. | Cada rota autenticada agora confirma no PostgreSQL que a conta continua ativa e com o mesmo papel. Sessões da conta são removidas na mesma transação que suspende o acesso. |

## Proteção por PIN da assinatura

- O perfil retorna apenas indicadores de existência; não entrega a imagem da assinatura sem PIN.
- O PIN tem de 6 a 12 dígitos e é armazenado somente como hash bcrypt.
- Cinco tentativas incorretas bloqueiam o PIN por 15 minutos. A contagem e o bloqueio ficam no banco e são compartilhados entre instâncias.
- A leitura/uso da assinatura e toda alteração exigem validação do PIN. O PIN não é salvo no navegador.
- A imagem da assinatura permanece cifrada com AES-256-GCM usando `PII_ENCRYPTION_KEY`.
- As migrações `019_signature_pin_protection.sql` e `020_persist_user_profile_name.sql` habilitam a proteção por PIN e impedem que o login Google sobrescreva o nome personalizado do perfil. Aplicar com `npm run db:migrate`.

## Limpeza e compatibilidade

- O endpoint antigo que retornava a assinatura em texto claro foi substituído por endpoints separados de metadados, desbloqueio protegido e gravação protegida.
- A criação, edição e assinatura do termo continuam disponíveis; a cópia para impressão permanece sem assinatura e não exige PIN.
- As dependências de PDF e importação CSV continuam em uso. Não foi removida nenhuma dependência ou superfície funcional sem evidência de que estivesse obsoleta.
- `npm run build` e `npm run lint` são usados para verificar compilação e qualidade estática. O aviso conhecido de chunk acima de 500 KB do Vite não afeta o funcionamento.
