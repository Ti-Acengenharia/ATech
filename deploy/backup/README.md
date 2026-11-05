# Rotina de Backup e Recuperação - ATech AC Engenharia

Esta pasta contém os scripts para automação de backups diários e restauração do banco de dados PostgreSQL na VPS.

---

### 1. Testando o Backup Manualmente

Na VPS, torne os scripts executáveis e execute o backup:

```bash
chmod +x deploy/backup/*.sh
./deploy/backup/backup-postgres.sh
```

Os arquivos de dump compactados serão salvos em `backups/` com o formato `atech_backup_YYYYMMDD_HHMMSS.sql.gz`.

---

### 2. Configurando no `crontab` da VPS (Execução Automática Diária)

Para agendar o backup diário às **02:00 da manhã**:

1. Abra o agendador de tarefas do servidor:
   ```bash
   crontab -e
   ```

2. Adicione a linha abaixo (ajuste o caminho do diretório da aplicação):
   ```cron
   0 2 * * * /opt/atech/deploy/backup/backup-postgres.sh >> /opt/atech/backups/cron.log 2>&1
   ```

O script mantém automaticamente o histórico dos últimos **30 dias**, excluindo arquivos mais antigos para não lotar o disco da VPS.

---

### 3. Como Restaurar um Backup

Para restaurar um backup existente:

```bash
./deploy/backup/restore-postgres.sh backups/atech_backup_20261104_020000.sql.gz
```

